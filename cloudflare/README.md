# وسيط الاتصال لمنصة أَثَر (Cloudflare Pages Function)

هذا تجهيز اختياري في مستودع التطوير فقط. لا يغير نشر GitHub Pages الحالي ولا قاعدة البيانات.

## إعداد مشروع Cloudflare Pages لاحقًا
- اربط مشروع Pages بمستودع التطوير `aboasmaa2273-code/ather-development` فقط.
- Production branch: `main`.
- Build command: `npm run build`.
- Build output directory: `dist`.
- أضف متغير البناء `VITE_ATHAR_API_TRANSPORT=proxy`.
- أضف متغير Function باسم `ATHAR_GAS_ENDPOINT` وقيمته رابط Apps Script الحالي المنتهي بـ `/exec`.

## قبل تفعيل النسخة الجديدة
1. انقل تحديث `gas/SharedDatabase.gs` إلى مشروع Apps Script ثم انشر إصدارًا جديدًا.
2. انشر مشروع Cloudflare Pages.
3. اختبر ping وتسجيل الدخول والقراءة والحفظ بحساب مخوّل قبل اعتماد الرابط الجديد.

## حماية النسخة الحالية
- من دون متغير البناء، تستمر نسخة GitHub Pages في استخدام النقل القديم.
- يحتفظ Apps Script بمسار HTML القديم؛ النقل الجديد يعمل فقط عند إرسال `transport=json`.
- لا يعيد الوسيط إرسال الطلب تلقائيًا عند فقد الاستجابة حتى لا يكرر عمليات الحفظ.
- لا توجد مفاتيح API أو كلمات مرور ضمن ملفات الواجهة أو هذا المستودع.
