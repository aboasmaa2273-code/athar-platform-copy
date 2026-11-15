interface Env {
  ATHAR_GAS_ENDPOINT: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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
    // Server-to-server: browser CORS and iframe restrictions do not apply.
    // Apps Script ContentService may redirect to script.googleusercontent.com;
    // the Fetch API follows that redirect automatically.
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
      // Never replay: Apps Script may have completed a write before its response was lost.
      return jsonResponse({
        success: false,
        error: "تعذرت قراءة استجابة Google. لم نُعِد إرسال الطلب لتجنب تكرار عملية الحفظ."
      }, 502);
    }
    return jsonResponse(result, upstream.ok ? 200 : 502);
  } catch {
    return jsonResponse({ success: false, error: "تعذر الوصول إلى خادم Google من وسيط الاتصال." }, 502);
  }
};
