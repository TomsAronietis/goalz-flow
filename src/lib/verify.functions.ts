/**
 * Verify enriched prospect data by re-scraping sources and asking AI to fact-check.
 * Returns a confidence score (0-100) and notes about which fields look accurate
 * vs. questionable.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const JINA = "https://r.jina.ai/";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function jinaFetch(url: string): Promise<string> {
  try {
    const res = await fetch(JINA + url, { headers: { Accept: "text/plain" } });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 8000);
  } catch {
    return "";
  }
}

const VerifySchema = z.object({
  confidence: z.number().min(0).max(100),
  notes: z.string(),
});

export const verifyProspect = createServerFn({ method: "POST" })
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
    if (!prospect.enriched_at) throw new Error("Run AUTO-ENRICH first.");

    // Re-scrape sources fresh
    const igText = await jinaFetch(`https://www.instagram.com/${prospect.ig_handle}/`);
    const siteText = prospect.website_url ? await jinaFetch(prospect.website_url) : "";

    const sys = `You are a fact-checker. Given the current stored prospect data and freshly scraped source text, verify each field.
Return JSON with:
- "confidence": 0-100 overall accuracy score
- "notes": short bullet-style summary (use "- ") — mark each field as OK, QUESTIONABLE, or MISSING with a brief reason. Keep under 600 chars.`;

    const stored = {
      first_name: prospect.first_name,
      location: prospect.location,
      niche: prospect.niche,
      brokerage: prospect.brokerage,
      email: prospect.email,
      phone: prospect.phone,
      website_url: prospect.website_url,
      follower_count: prospect.follower_count,
      awards: prospect.awards,
      press_mentions: prospect.press_mentions,
    };

    const userPrompt = `=== STORED DATA ===
${JSON.stringify(stored, null, 2)}

=== FRESH INSTAGRAM TEXT ===
${igText || "(failed to scrape)"}

=== FRESH WEBSITE TEXT (${prospect.website_url ?? "none"}) ===
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
              name: "save_verification",
              description: "Save the verification result",
              parameters: {
                type: "object",
                properties: {
                  confidence: { type: "number" },
                  notes: { type: "string" },
                },
                required: ["confidence", "notes"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "save_verification" } },
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
    const parsed = VerifySchema.safeParse(JSON.parse(args));
    if (!parsed.success) throw new Error("AI returned malformed data.");

    const { error: uErr } = await supabase
      .from("prospects")
      .update({
        verified_at: new Date().toISOString(),
        verification_confidence: Math.round(parsed.data.confidence),
        verification_notes: parsed.data.notes,
      } as never)
      .eq("id", data.prospectId);
    if (uErr) throw new Error(uErr.message);

    return { ok: true, confidence: parsed.data.confidence, notes: parsed.data.notes };
  });
