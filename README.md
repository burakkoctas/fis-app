# Fiş — AI destekli yapılacaklar listesi

Mobil tarayıcı + bilgisayar tarayıcısından çalışır. Android'de "ana ekrana ekle"
ile gerçek bir uygulama gibi simgeyle açılır (PWA — ayrı bir native app değil).

## 1. Gemini API anahtarı al
https://aistudio.google.com/apikey adresinden ücretsiz bir anahtar oluştur.
(Öğrenci üyeliğin bu anahtarın kullanım kotasını artırıyor, anahtarın kendisi
öğrenci hesabınla aynı Google hesabından alınıyor.)

## 2. Yerelde dene (opsiyonel)
```
npm install
npm run dev
```
Ardından `.env` dosyası yerine terminalde:
```
GEMINI_API_KEY=xxxx vercel dev
```
şeklinde çalıştırman gerekir çünkü `/api/parse-task` bir Vercel serverless
fonksiyonudur, sade `vite dev` onu çalıştırmaz. En kolayı doğrudan adım 3'e
geçip Vercel üzerinde denemek.

## 3. Vercel'e deploy et
1. Bu klasörü bir GitHub reposuna yükle.
2. https://vercel.com üzerinde "New Project" → reposunu seç → Import.
3. Deploy etmeden önce **Settings → Environment Variables** kısmına ekle:
   - `GEMINI_API_KEY` = aldığın anahtar
4. Deploy'a bas. Birkaç saniyede `senin-projen.vercel.app` adresini verir.

## 4. Android'de kurulum (native app gibi)
1. Telefonda Chrome ile `senin-projen.vercel.app` adresini aç.
2. Sağ üst ⋮ menüsü → **"Ana ekrana ekle"**.
3. Artık ana ekranda kendi ikonuyla (Fiş) açılıyor, tam ekran, adres çubuğu yok.

Bilgisayardan da aynı adresi tarayıcıda açman yeterli — aynı arayüz.

## 5. Cihazlar arası senkron (Supabase)
1. https://supabase.com üzerinde ücretsiz bir proje oluştur.
2. Proje içinde **SQL Editor**'ı aç, bu depodaki `supabase-schema.sql` dosyasının
   tamamını yapıştırıp çalıştır. Bu, `tasks` ve `habits` tablolarını ve
   "herkes sadece kendi verisini görür" güvenlik kurallarını (RLS) kurar.
3. **Project Settings → API** kısmından şunları al:
   - `Project URL`
   - `anon public` key
4. Vercel projenin **Settings → Environment Variables** kısmına ekle:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public key
5. **Authentication → Providers** kısmında Email girişinin (magic link) açık
   olduğundan emin ol (varsayılan olarak açıktır).
6. Yeniden deploy et.

Artık uygulamayı ilk açtığında e-postanı yazıp sana gelen bağlantıya tıklıyorsun
— hem telefonda hem bilgisayarda aynı e-postayla giriş yaparsan, görevler ve
alışkanlıklar iki cihaz arasında **anlık olarak** (Supabase realtime ile)
senkronize olur. `anon` anahtar tarayıcıda görünür olabilir, bu normaldir —
gerçek koruma adım 2'deki RLS kurallarından gelir, her kullanıcı sadece
kendi satırlarını okuyup yazabilir.

## 6. Bildirimler (Push)
Görev saati yaklaşınca (5 dakika kala) telefona/tarayıcıya bildirim gider —
Android'de uygulama kapalıyken bile.

1. Bu depoda `node generate-vapid-keys.js` çalıştır, çıkan iki satırı not al.
   (Node kurulu değilse: `npm install` sonrası çalıştır.)
2. Vercel **Environment Variables** kısmına ekle:
   - `VAPID_PUBLIC_KEY` = çıkan public key
   - `VAPID_PRIVATE_KEY` = çıkan private key
   - `VITE_VAPID_PUBLIC_KEY` = aynı public key (tarayıcı tarafı bunu okuyor)
   - `SUPABASE_SERVICE_ROLE_KEY` = Supabase **Project Settings → API** kısmındaki
     `service_role` anahtarı (gizli — sadece sunucu tarafında kullanılır, asla
     tarayıcıya göndermeyiz)
   - `CRON_SECRET` = kendi uydurduğun rastgele bir metin, ör. `xk92-fis-secret`
3. Supabase SQL Editor'da güncel `supabase-schema.sql`'i tekrar çalıştır
   (yeni `push_subscriptions` tablosu ve `tasks.notified` sütunu eklendi).
4. Deploy et. Uygulamada sol menüdeki (mobilde üstteki zil ikonu) **"Bildirimleri
   aç"** butonuna basıp izin ver.
5. Hatırlatmaların gerçekten gönderilmesi için birinin `/api/send-reminders`
   adresini düzenli aralıklarla çağırması gerekiyor — Vercel'in ücretsiz
   planı sadece günde bir kez cron çalıştırmaya izin veriyor, 5 dakikada bir
   için yeterli değil. Bunun yerine ücretsiz bir dış servis kullan:
   - https://cron-job.org üzerinde ücretsiz hesap aç
   - Her 5 dakikada bir şu adrese GET isteği atacak şekilde ayarla:
     `https://senin-projen.vercel.app/api/send-reminders?secret=CRON_SECRET_değerin`


## Dosya yapısı
- `src/App.jsx` — tüm uygulama arayüzü ve mantığı, giriş ekranı dahil
- `src/supabaseClient.js` — Supabase bağlantısı
- `src/push.js` — bildirim izni isteme ve abonelik kaydı
- `supabase-schema.sql` — veritabanı tabloları ve güvenlik kuralları
- `api/parse-task.js` — Gemini'ye giden istek burada, anahtar tarayıcıya hiç inmez
- `api/send-reminders.js` — zamanı gelen görevler için push bildirimi gönderir (cron ile tetiklenir)
- `generate-vapid-keys.js` — bildirim anahtarlarını üretmek için bir kerelik script
- `public/manifest.json`, `public/sw.js` — Android'de "ana ekrana ekle" ve push bildirimleri için PWA ayarları
