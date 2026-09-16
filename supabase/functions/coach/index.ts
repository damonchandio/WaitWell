import { createClient } from "jsr:@supabase/supabase-js@2";

const CRISIS = ["suicide","kill myself","end my life","end it all","want to die",
  "self harm","self-harm","hurt myself","no reason to live","better off dead","cant go on","can't go on"];
const FREE_LIMIT = 5;

const CONDITION_FULL: Record<string,string> = {
  knee:"knee or hip surgery", back:"back or spine treatment",
  mental:"mental health support", cardiac:"cardiac care",
  gastro:"general surgery", other:"specialist treatment"
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "unauthorised" }, 401);

    const { messages } = await req.json();
    const last = (messages?.at(-1)?.content ?? "").toLowerCase();

    // Server-side crisis screen — no model call, no quota used
    if (CRISIS.some((k) => last.includes(k))) return json({ crisis: true });

    const { data: p } = await supabase.from("profiles")
      .select("name, condition, severity, wait_time, concerns, is_pro, coach_used_week, start_date, appointment_date")
      .eq("id", user.id).single();
    if (!p) return json({ error: "no profile" }, 400);
    if (!p.is_pro && (p.coach_used_week ?? 0) >= FREE_LIMIT) return json({ paywall: true });

    // Fetch the last 14 logged days (newest first) for trend analysis.
    const { data: logs } = await supabase.from("symptom_logs")
      .select("pain, mobility, mood, sleep, triggers").eq("user_id", user.id)
      .order("log_date", { ascending: false }).limit(14);
    const lg = logs?.[0];
    const logLine = lg ? `pain ${lg.pain}/10, mobility ${lg.mobility}/10, mood ${lg.mood}/10, sleep ${lg.sleep}/10` : "none yet";
    const days = p.start_date ? Math.floor((Date.now() - new Date(p.start_date).getTime())/86400000) : 0;

    // ---- Trend summary: most recent 7 logged days vs the 7 before ----
    const all = logs ?? [];                 // newest first
    const recent = all.slice(0, 7);
    const prior = all.slice(7, 14);
    const mean = (arr: any[], k: string) => {
      const v = arr.map((l) => l[k]).filter((x) => typeof x === "number");
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    // [key, label, higherIsBetter]
    const metrics: [string, string, boolean][] = [
      ["pain", "Pain", false], ["mobility", "Mobility", true],
      ["mood", "Mood", true], ["sleep", "Sleep", true],
    ];
    const trendParts = metrics.map(([k, label, higherBetter]) => {
      const r = mean(recent, k); if (r === null) return null;
      const pr = mean(prior, k);
      let dir = "";
      if (pr !== null) {
        const diff = r - pr;
        if (Math.abs(diff) < 0.5) dir = " (steady)";
        else dir = (higherBetter ? diff > 0 : diff < 0) ? " (improving)" : " (worsening)";
      }
      return `${label} avg ${r.toFixed(1)}/10${dir}`;
    }).filter(Boolean);
    const trigCounts: Record<string, number> = {};
    all.forEach((l) => (l.triggers ?? []).forEach((t: string) => { trigCounts[t] = (trigCounts[t] ?? 0) + 1; }));
    const topTrig = Object.keys(trigCounts).sort((a, b) => trigCounts[b] - trigCounts[a]).slice(0, 3);
    let trendSummary = all.length
      ? `Last 7 logged days vs the 7 before: ${trendParts.join("; ")}.`
      : "No symptom logs recorded yet.";
    if (topTrig.length) trendSummary += ` Most frequent flare triggers: ${topTrig.join(", ")}.`;

    // ---- Real appointment line (replaces the hardcoded "12 days") ----
    let apptLine = "No appointment date set yet.";
    if (p.appointment_date) {
      const a = new Date(p.appointment_date); a.setHours(0, 0, 0, 0);
      const t = new Date(); t.setHours(0, 0, 0, 0);
      const d = Math.round((a.getTime() - t.getTime()) / 86400000);
      const dateStr = a.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      if (d < 0) apptLine = `Last appointment was ${dateStr} (${Math.abs(d)} day(s) ago).`;
      else if (d === 0) apptLine = `Appointment is TODAY (${dateStr}).`;
      else if (d === 1) apptLine = `Appointment is TOMORROW (${dateStr}).`;
      else apptLine = `Next appointment in ${d} days (${dateStr}).`;
    }

    const system = `You are the WaitWell AI Coach, a warm, grounded companion for someone in the UK on an NHS waiting list. Help them feel less alone and more in control during a long, anxious wait.

USER PROFILE (use naturally, do not recite):
- Name: ${p.name ?? "there"}
- Waiting for: ${CONDITION_FULL[p.condition] ?? "specialist treatment"}
- Severity: ${p.severity}/10
- Expected wait: ${p.wait_time}; currently day ${days}
- Main concerns: ${(p.concerns ?? []).join(", ") || "not specified"}
- Latest symptom log: ${logLine}
- Symptom trends: ${trendSummary}
- ${apptLine}

HOW TO RESPOND:
- One short line of genuine acknowledgement, then 2-3 concrete, small, realistic next steps as a numbered list. Under ~120 words. Calm, plain-spoken British tone, no emojis. Use the symptom trends when relevant (e.g. note an improving or worsening pattern), and reference the appointment timing when it helps them feel prepared. Suggest things like ringing the GP/consultant secretary to check list position, a brief coping technique, or logging something to raise at the appointment.

HARD RULES:
- You are NOT a clinician. Never diagnose, recommend medication changes, estimate medical timelines, or judge whether symptoms are serious. For anything clinical, direct them to their GP, NHS 111, or care team.
- Never claim you can change their place on the waiting list.
- If they express suicidal thoughts, self-harm, or being unable to stay safe, drop the coaching format and respond with warmth and urgency, pointing to Samaritans 116 123, NHS 111 option 2, or 999/A&E, and encourage them to reach out to someone they trust.`;

    // ---- Gemini call ----
    // Map our history to Gemini's format: 'assistant' -> 'model'
    const contents = (messages ?? []).map((m: any) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

   const MODEL = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

    const aiRes = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": Deno.env.get("GEMINI_API_KEY")!,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: 1000, temperature: 0.7 },
      }),
    });
    const data = await aiRes.json();
    console.log("GEMINI STATUS:", aiRes.status);
    console.log("GEMINI RAW:", JSON.stringify(data));
    const reply = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((part: any) => part.text).join("").trim()
      || "Sorry, I couldn't respond just now. Please try again.";
    // ---- end Gemini call ----

    if (!p.is_pro) {
      await supabase.from("profiles")
        .update({ coach_used_week: (p.coach_used_week ?? 0) + 1 })
        .eq("id", user.id);
    }

    return json({ reply });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...cors, "content-type": "application/json" },
  });
}