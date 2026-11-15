interface Env {
  ATHAR_GAS_ENDPOINT: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

type PagesFunctionContext<E> = { request: Request; env: E };

function extractLegacyGasPayload(html: string): Record<string, unknown> | null {
  // Apps Script sometimes HTML-escapes the postMessage envelope as JavaScript
  // hex escapes (for example \x7b and \x22). Decode only those escapes;
  // never execute returned HTML or JavaScript.
  const markerIndex = html.indexOf("payload:");
  if (markerIndex < 0) return null;

  const scriptEnd = html.indexOf("</script>", markerIndex);
  const encoded = html.slice(markerIndex + "payload:".length, scriptEnd < 0 ? undefined : scriptEnd);
  const decoded = encoded.replace(/\\+x([0-9a-fA-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  const start = decoded.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < decoded.length; i++) {
    const ch = decoded[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const value = JSON.parse(decoded.slice(start, i + 1));
          return value && typeof value === "object" && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export const onRequestPost = async ({ request, env }: PagesFunctionContext<Env>): Promise<Response> => {
  const requestOrigin = request.headers.get("Origin");
  const pageOrigin = new URL(request.url).origin;
  if (requestOrigin && requestOrigin !== pageOrigin) {
    return jsonResponse({ success: false, error: "مصدر الطلب غير مسموح." }, 403);
  }
  if (!env.ATHAR_GAS_ENDPOINT ||
      !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.ATHAR_GAS_ENDPOINT)) {
    return jsonResponse({ success: false, error: "لم يُضبط عنوان خادم أَثَر في إعدادات الوسيط." }, 503);
  }

  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 1_000_000) return jsonResponse({ success: false, error: "حجم الطلب أكبر من الحد المسموح." }, 413);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    payload = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ success: false, error: "بيانات الطلب غير صالحة." }, 400);
  }

  const form = new URLSearchParams({
    payload: JSON.stringify(payload),
    requestId: crypto.randomUUID(),
    transport: "json"
  });

  try {
    const upstream = await fetch(env.ATHAR_GAS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString(),
      redirect: "follow"
    });
    const rawResult = await upstream.text();

    let result: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawResult);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      result = parsed as Record<string, unknown>;
    } catch {
      const legacyResult = extractLegacyGasPayload(rawResult);
      if (legacyResult) return jsonResponse(legacyResult, upstream.ok ? 200 : 502);

      // Never replay: Apps Script may have completed a write before its response was lost.
      const isPing = payload.action === "ping";
      const preview = isPing
        ? rawResult.replace(/<script[\s\S]*?<\/script>/gi, "[script]")
            .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 240)
        : undefined;
      const titleMatch = isPing ? rawResult.match(/<title[^>]*>([\s\S]*?)<\/title>/i) : null;
      const diagnostic = isPing ? {
        upstreamStatus: upstream.status,
        contentType: upstream.headers.get("content-type") || "unknown",
        finalHost: (() => {
          try { return new URL(upstream.url).hostname; }
          catch { return "unknown"; }
        })(),
        responsePreview: preview,
        legacyPayloadMarkerFound: rawResult.includes("payload:"),
        legacyPayloadStart: (() => {
          const i = rawResult.indexOf("payload:");
          return i < 0 ? null : rawResult.slice(i, i + 48);
        })(),
        htmlTitle: titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").slice(0, 120) : null,
        looksLikeGoogleSignIn: /accounts\.google\.com|ServiceLogin|sign in to continue/i.test(rawResult),
        containsAppsScriptEnvelope: rawResult.includes("ATHAR_DB_RESULT")
      } : undefined;
      return jsonResponse({
        success: false,
        error: "تعذرت قراءة استجابة Google. لم نُعِد إرسال الطلب لتجنب تكرار عملية الحفظ.",
        ...(isPing ? { diagnostic } : {})
      }, 502);
    }
    return jsonResponse(result, upstream.ok ? 200 : 502);
  } catch {
    return jsonResponse({ success: false, error: "تعذر الوصول إلى خادم Google من وسيط الاتصال." }, 502);
  }
};
