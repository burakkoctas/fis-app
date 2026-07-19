// Çalıştır: node generate-vapid-keys.js
// Çıktıyı Vercel env variable'larına ekle (README adım 6).
const webpush = require("web-push");
const keys = webpush.generateVAPIDKeys();
console.log("VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
