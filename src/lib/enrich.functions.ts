/**
 * Prospect enrichment via Jina AI Reader (free scraping) + Lovable AI (Gemini Flash Lite).
 *
 * Flow:
 *  1. Scrape instagram.com/<handle> with https://r.jina.ai/ to get bio + link-in-bio
 *  2. If we find a website URL, scrape that too
 *  3. Feed all text into Gemini Flash Lite with a structured schema
 *  4. Update the prospect row
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const JINA = "https://r.jina.ai/";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function jinaFetch(url: string): Promise<string> {
  try {
    const res = await fetch(JINA + url, {
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) return "";
    const text = await res.text();
    // Cap length to keep prompts cheap
    return text.slice(0, 8000);
  } catch {
    return "";
  }
}

function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^ \s)]+/);
  if (!m) return null;
  const u = m[0].replace(/[.,;:!?)]+$/, "");
  if (u.includes("instagram.com") || u.includes("cdninstagram") || u.includes("fbcdn")) return null;
  return u;
}

const EnrichSchema = z.object({
  first_name: z.string().nullable(),
  niche: z.string().nullable(),
  location: z.string().nullable(),
  website_url: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  brokerage: z.string().nullable(),
  bio: z.string().nullable(),
  intel_brief: z.string().nullable(),
  website_gaps: z.string().nullable(),
  awards: z.array(z.string()).default([]),
  press_mentions: z.array(z.string()).default([]),
  follower_count: z.number().nullable(),
});

export const enrichProspect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ prospectId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured.");

    const { data: prospect, error: pErr } = await supabase
      .from("prospects")
      .select("*")
      .eq("id", data.prospectId)
      .single();
    if (pErr || !prospect) throw new Error("Prospect not found.");

    // 1. Scrape IG profile
    const igText = await jinaFetch(`https://www.instagram.com/${prospect.ig_handle}/`);

    // 2. Try to find a website (prefer existing, else extract from IG text)
    let websiteUrl = prospect.website_url || extractFirstUrl(igText);
    let siteText = "";
    if (websiteUrl) {
      siteText = await jinaFetch(websiteUrl);
    }

    // 3. Structure with Gemini Flash Lite
    const sys = `You are a research assistant. Extract structured prospect data from raw scraped text.
Return ONLY valid JSON matching the requested schema. Use null for unknown fields.
- "niche": their professional category in 2-5 words (e.g. "Realtor - Luxury Homes", "Wellness Coach")
- "intel_brief": 2-3 sentences summarizing who they are, what they do, recent activity
- "website_gaps": 1-2 sentences on what their site is missing (SEO, CTA, mobile, etc.)
- "brokerage": only if real estate (e.g. "eXp Realty", "Compass", "Keller Williams")
- "awards" / "press_mentions": short strings, max 5 each
- Only include email/phone if explicitly visible in the scraped text.`;

    const userPrompt = `Instagram handle: @${prospect.ig_handle}

=== INSTAGRAM PAGE TEXT ===
${igText || "(failed to scrape)"}

=== WEBSITE TEXT (${websiteUrl ?? "none found"}) ===
${siteText || "(none)"}`;

    const aiRes = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "save_prospect",
              description: "Save structured prospect data",
              parameters: {
                type: "object",
                properties: {
                  first_name: { type: ["string", "null"] },
                  niche: { type: ["string", "null"] },
                  location: { type: ["string", "null"] },
                  website_url: { type: ["string", "null"] },
                  email: { type: ["string", "null"] },
                  phone: { type: ["string", "null"] },
                  brokerage: { type: ["string", "null"] },
                  bio: { type: ["string", "null"] },
                  intel_brief: { type: ["string", "null"] },
                  website_gaps: { type: ["string", "null"] },
                  awards: { type: "array", items: { type: "string" } },
                  press_mentions: { type: "array", items: { type: "string" } },
                  follower_count: { type: ["number", "null"] },
                },
                required: ["awards", "press_mentions"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "save_prospect" } },
      }),
    });

    if (!aiRes.ok) {
      const body = await aiRes.text();
      if (aiRes.status === 429) throw new Error("AI rate limit hit. Wait a minute.");
      if (aiRes.status === 402) throw new Error("AI credits exhausted. Add credits in Settings > Workspace > Usage.");
      throw new Error(`AI call failed [${aiRes.status}]: ${body.slice(0, 200)}`);
    }
    const aiJson = await aiRes.json();
    const args = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("AI returned no structured data.");
    const parsed = EnrichSchema.safeParse(JSON.parse(args));
    if (!parsed.success) throw new Error("AI returned malformed data.");
    const e = parsed.data;

    // Use new website URL if AI found one
    if (!websiteUrl && e.website_url) websiteUrl = e.website_url;

    // Build patch — only overwrite empty fields, but always update intel/awards/press
    const patch: Record<string, unknown> = {
      enriched_at: new Date().toISOString(),
      awards: e.awards,
      press_mentions: e.press_mentions,
    };
    if (!prospect.first_name && e.first_name) patch.first_name = e.first_name;
    if (!prospect.location && e.location) patch.location = e.location;
    if (!prospect.website_url && websiteUrl) patch.website_url = websiteUrl;
    if (!prospect.bio && e.bio) patch.bio = e.bio;
    if (!prospect.follower_count && e.follower_count) patch.follower_count = e.follower_count;
    if (!prospect.niche && e.niche) patch.niche = e.niche;
    if (!prospect.email && e.email) patch.email = e.email;
    if (!prospect.phone && e.phone) patch.phone = e.phone;
    if (!prospect.brokerage && e.brokerage) patch.brokerage = e.brokerage;
    if (e.intel_brief) patch.intel_brief = e.intel_brief;
    if (e.website_gaps) patch.website_gaps = e.website_gaps;

    const { error: uErr } = await supabase.from("prospects").update(patch as never).eq("id", data.prospectId);
    if (uErr) throw new Error(uErr.message);

    return { ok: true };
  });
