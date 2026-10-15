# Balık Avı — yapılanlar ve yapılmayanlar

Tarih: 15 Ekim 2026 (ikinci tur eklendi: §8). Hiçbir şey commit edilmedi; her şey çalışma ağacında. Ayrıntılı teknik notlar için `NOTES.md`.

## 1. Kurulum ve süreç

**Yapıldı**
- `threejs-game-skills` reposundaki 9 skill `.claude/skills/` altına kopyalandı (Tripo, Gemini, ElevenLabs gerektirenler dahil; anahtarlar yok, ücretli).
- Tripo için 13 balığın promptları `docs/TRIPO-PROMPTS.md` içinde (öncelik sırasıyla).
- Üç ajanla (oyun/ekonomi, grafik, UI/ses) tam denetim yapıldı ve bulgular önceliklendirildi.

**Yapılmadı**
- Tripo'dan gelen GLB modeller henüz yok. Balıklar hâlâ prosedürel. GLB yükleme altyapısı (`assets/<tür>.glb`, yoksa prosedürele düş) hazırlanmadı.

## 2. Denetim sonrası düzeltmeler

**Mobil**
- Dokunmatik: parmak, stüdyonun fare yoluna çevriliyor (`src/game/touch.js`). Sürükle = nişan, basılı tut = ateş.
- Viewport meta, `touch-action:none`, seçim/zoom engelleri.
- Dikey ekranda "Cihazı yatay çevir" uyarısı (oyun durur).
- ≥44 px butonlar, kenar güvenli payı, uzun metinlerin otomatik küçülmesi.
- iOS ses kilidi gerçek `touchend` içinde; parmak kaybolunca/odak gidince ateş takılı kalmıyor.
- `orientationchange` ve `visualViewport` resize dinleniyor.
- Profil + ayarlar localStorage'a kaydediliyor; yalnızca gerçek açılışta yükleniyor (`reset(seed)` hep temiz). Bozuk kayıt doğrulanıyor.

**Performans**
- Çizim çağrıları 1332 → ~260 (statik süsler birleştirildi, yosun/anemon instanced, kabarcık/plankton `Points`).
- Mermi/ağ/kıvılcım materyalleri havuzda; kare başına ayırmalar (ejderha izi vb.) kaldırıldı.
- MSAA post-processing hedefinde; telefonda hafif kalite kademesi (DPR 1,5, 2× MSAA, yarı bloom, dalgalanma kapalı); composer kurulamazsa düz render.

**Ekonomi/doğruluk**
- Oturum değişince ve balık kaybolunca uçuştaki mermiler iade ediliyor.
- Boss sayacı sadece boss yokken işliyor; sürü sayısı hedefi aşmıyor.
- Gün serisi atlanan günde sıfırlanıyor; tamamlanıp alınmamış hedef gün atlayınca otomatik ödeniyor.
- Simüle makbuz tekrar kullanılamıyor (`ALLOW_SIMULATED_IAP` bayrağı).
- "Win N coin" hedefi tek öldürmede en çok 500 sayıyor.
- Boss'a her vuruşta sayaç popup'ı çıkıyor.

**Ses**
- Ses sayısı sınırı, ses başına minimum aralık, ıskalama sesi, tek tuşla sessize alma (HUD'da SES düğmesi).

## 3. Ekonomi / slot katmanı (hepsi sunucu tarafı, RTP-nötr)

- **Başlangıç bakiyesi:** 1000 → 200 coin (öneri sayısıydı, kullanıcı onayladı: "hepsini yap").
- **Altın balık:** boss olmayanların %6'sı; ×2/×3/×5 ek çarpan; parlayan hale.
- **Kombo:** 8 sn içinde her öldürme +%10, en çok ×2.
- **Altın Fırtına:** boss öldürünce 10 sn ×2.
- **Jackpot (3 kademe):**
  - MINI ×20 ve MINOR ×100: her isabette zar, öldürsün ya da öldürmesin. Altın balıkta 1/180 ve 1/1500, diğerlerinde 1/9000 ve 1/20000.
  - MAJOR: mermi başına %1 havuz, Altın Köpekbalığı öldürülünce ödenir, ödemeden sonra 0'dan başlar. Yeni profil 100 ile başlar.
- **RTP kuralı:** çarpan M olan her özellik öldürme şansını M'ye böler; sabit jackpotların beklenen değeri öldürme şansından düşülür.
- **Simülatör** (`tools/rtp-sim.mjs`, 6M atış × 3 tohum): strateji başına %95,9–97,9, ortalama ~%96,7 (hedef %96,5). Küçük balık stratejisi hedefin yarım puan kadar üstünde çıktı; varyans gibi duruyor, kesinleştirilmedi.
- Oturum özetinde "Geri dönüş %" satırı.
- Yeni oyuncu için yönlendirilmiş ilk dakika (5. sn altın orta balık, 14. sn sıradan orta balık; sadece çıkış sırası).

## 4. Oyun hissi

- Her isabet: kamera hafif sarsılır, balık geri itilir.
- Orta öldürme: kısa hit-stop. Büyük/boss: ağır çekim, altın flaş, gümbürtü sesi.
- Kombo arttıkça isabet sesi inceliyor; altın balıkta çan sesi.
- Dokunmatikte titreşim (isabet/öldürme/jackpot seviyesine göre).

## 5. Arayüz (kısmen bende, kısmen başka tasarımcıda)

**Bende yapıldı**
- Buton/panel seti (`src/game/skin.js`): kalın çerçeveli, parlak yüzlü, basınca çöken butonlar; çerçeveli cam paneller; kurdele başlıklar; yıldız rozetler.
- Lilita One yazı tipi (OFL), Türkçe İ Ş Ğ dahil.
- Mağaza yeniden tasarımı: ışınlı kartlar, coin yığınları, bonus rozetleri, "EN POPÜLER/EN İYİ DEĞER", reklam şeridi.
- HUD: jackpot paneli, kombo göstergesi, Altın Fırtına çubuğu.

**Başka tasarımcıya devredildi** (`ui.js`, `skin.js`, ekran çizimleri; dosyalarda onların değişiklikleri var)
- Mağaza dışı ekranların oyun tarzı yeniden kompozisyonu (hedef, koleksiyon, ayarlar, duraklatma, coin bitti).
- ~~En büyük pakette "14.000" yazısı coin yığınının üstüne biniyor.~~ Düzeltildi (§8).

## 6. Yapılmadı / açık işler

**Performans (UI dosyalarında, tasarımcıya)**
- ~~HUD her karede baştan çiziliyor.~~ Düzeltildi (§8): durağan ekranda karede 0 yeniden çizim.
- ~~`skin.js`'te gerçek zamanlı `setTimeout` ve sınırsız görsel önbelleği.~~ Düzeltildi (§8). HUD tuvali hâlâ çizim arabelleği çözünürlüğünde.

**Oyun özellikleri (tasarım ajanının listesinden, yapılmadı)**
- ~~Bomba / yıldırım / dondurma balıkları~~ Deniz Mayını, Şimşek Balığı ve Buz Balığı olarak yapıldı (`docs/PROGRESSION.md` §15, §16).
- ~~XP ve oyuncu seviyesi, kozmetik.~~ Yapıldı (`docs/PROGRESSION.md` §13).
- ~~3'lü günlük görev tahtası~~ yapıldı (§13). Gün serisi görseli hâlâ yok.
- Balık davranış çeşitliliği (sürü dağılması, kaçış, boss fazları).
- ~~Zamanlı etkinlikler (balık akını, hazine baloncuğu, boss geri sayımı).~~ Gelgit döngüsüyle yapıldı (`docs/PROGRESSION.md` §12). Boss Turu ve Bomba Balığı hâlâ yok.
- Güç yükseltmeleri (yayılma atışı, delici mermi, hedef kilidi).
- Ayrı ateş düğmesi, otomatik nişan yardımı. (Dokunmatikte nişan ve ateş hâlâ aynı hareket: her nişan düzeltmesi mermi harcıyor.)
- Boss "can çubuğu" bilerek yapılmadı (her vuruş bağımsız şans; can çubuğu yanıltıcı ilerleme gösterir). Yerine boss uyarısı ve boss etiketi geldi (§8). MINI/MINOR göstergesi eklendi: jackpot panelinin iki yanında, mevcut bahisle kazanılacak tutar; tutan gösterge yanıp sönüyor (§8).
- Sorumlu oyun: net sonuç satırı, 10 dakikada bir süre hatırlatması ve boss varken "coin bitti" penceresinde mağaza teklif etmeme yapıldı (§8). Harcama limiti uyarısı hâlâ yok.

**Diğer**
- Dikey ekran gerçek düzen değil, yalnızca döndürme uyarısı.
- ~~İngilizce menüde logo yerine metin başlık.~~ İngilizce logo eklendi (§8). İngilizce ekranlar ayrıca gezildi ve düzeltildi.
- Profil yalnızca cihazda; gerçek çözüm sunucu veritabanı.
- IAP / AdMob / analytics gerçek servislere bağlı değil (doğru çağrı noktalarıyla taslak).
- Gizlilik ve kullanım şartları yer tutucu.
- Lider tablosu yok.
- Gerçek telefonda test yapılmadı; ölçümler headless Chromium ve tarayıcının mobil taklidinde (844×390, DPR 3).
- Pencere boyutu değişince (telefon döndürme, iOS adres çubuğu) HUD bozuluyor: `src/hud.js` doku boyutunu yenilemiyor. Dosya stüdyoya ait; `NOTES.md`'de `HARNESS: hud-resize` olarak kayıtlı.
- `/vendor/` (three.js) repoda yok: oyun yalnızca Genex içinde ya da vendor klasörü elle eklenince açılıyor.

## 7. Dosya haritası (bu turda eklenen/değişen ana dosyalar)

| Dosya | Ne için |
| --- | --- |
| `src/economy/config.js`, `service.js` | Slot katmanı, jackpot, RTP kuralları |
| `tools/rtp-sim.mjs` | RTP simülatörü (jackpot ödemelerini sayıyor) |
| `src/game/touch.js` | Dokunma → fare olayı, bırakma güvenceleri |
| `src/game/audio.js` | Ses sınırı, miss/thump/chime, iOS toparlama |
| `src/game/effects.js`, `fishes.js`, `world.js`, `post.js` | Performans ve görüntü |
| `src/game/skin.js`, `ui.js`, `i18n.js` | Buton/panel kiti, metinler |
| `src/main.js` | Akış, HUD, oyun hissi, kayıt |
| `docs/TRIPO-PROMPTS.md` | Tripo promptları |
| `NOTES.md` | Teknik notlar |
| `assets/ui/*.webp`, `tools/build-webp.sh` | Oyunun yüklediği WebP görseller ve yeniden üretme betiği (§8) |
| `src/game/touch.js` → `installMinPress` | Kısa tıklamaların kaybolmaması (§8) |

## 8. İkinci tur: skill'lere göre denetim ve paketler (15 Ekim 2026, akşam)

Dört skill'le (oynanış, grafik, arayüz, tarayıcıda QA/profil) uygulamanın tamamı denetlendi; bulgular paketler halinde düzeltildi. Her paket tarayıcıda (masaüstü, 4:3, 16:10, telefon taklidi) denendi. Ayrıntılar `NOTES.md` içinde.

**Kritik düzeltmeler**
- Ayarlardaki "Ertesi güne geç (test)" satırı oyuncuya kapandı (sınırsız coin açığıydı); yalnızca adreste `?dev` varsa görünüyor.
- Jackpot bahse oranla ödeniyor (havuz × bahis/10); 1 coin'lik atış artık 10'luk atışların biriktirdiği havuzu alamıyor. HUD, mevcut bahsin kazanacağı payı gösteriyor.
- `reset(seed)` önceki oturumdan kalan her şeyi sıfırlıyor (determinizm).
- Bir düğmeye basmak artık mermi harcamıyor; coin bitince otomatik ateş kapanıyor.
- Balıklar sola yüzerken de yanlarını gösteriyor; balıklar sisten etkilenmiyor (su mavi kalıyor, balıklar canlı).
- Kurdele başlıklar gerçek oranında (önceden %47 basıktı).

**Ekonomi ve oturum**
- Bahis sınırı: bir bahis, bakiye o bahsin 50 katıyken açık (200 coin: 1-2, 250: 5, 500: 10). Bakiye düşünce top kendiliğinden küçülüyor; kilitli bahiste "250 coin ile açılır" yazıyor. Sınırı sunucu tarafı uyguluyor.
- Simülatörle (saniyede 6 atış, sürekli ateş): varsayılan bahisle ortanca oturum 5,0 dk; hep en yüksek bahsi isteyen oyuncuda 2,7 dk (önceden 10'luk bahisle ~13 sn). RTP değişmedi (%96,2-98,0).
- Isınma süresi oturuma sayılmıyor; havuz muhasebesi kesin; kayıt dosyası alan alan doğrulanıyor.
- Sonuç ekranında renkli "Net" satırı ve Türkçe "%120,0" biçimi; 10 dakikada bir süre hatırlatması; boss varken "coin bitti" penceresinde mağaza yok.

**Arayüz ve mobil**
- HUD değişmeyen öğeyi yeniden göndermiyor: durağan ekranda karede 0 yeniden çizim (önceden her karede tüm öğeler). Ölçüm için `state().hudWrites`.
- Telefonda yazılar panellerle aynı ölçekte (önceden %23 büyüktü ve taşıyordu); dar ekranlarda (16:10, 4:3) üst bar sıkışıyor, çakışma yok.
- Dokunmatikte düğmelere parmak boyunda görünmez dokunma alanı; 40 ms'den kısa tıklamalar kaybolmuyor.
- Yükleme çubuğu gerçek: büyük görseller ve 26 balık portresi açılışta yükleniyor.
- Mağaza: coin yığınları rakamın üstünde, reklam düğmesi noktaları örtmüyor, dar ekranda kartlar ve başlık küçülüyor. Ayarlar: "Misafir" düğmesi okunur boyutta, açıklamalar 4:3'te sığıyor.
- Boss uyarısı: boss'a 5 sn kala jackpot panelinin altında geri sayım (gümbürtü, kırmızı nabız, titreşim); boss ekrandayken adı ve ödül aralığı. Ortadaki duyurular yukarı alındı (alanın ortası boş).
- İngilizce: 16 ekran üç boyutta gezildi; taşan metinler kısaltıldı.
- İngilizce logo ("FISH HUNT"): Türkçe logonun tarzında; oyunun fontu ve koleksiyon portreleriyle tuvalde kompoze edildi (görsel üretim anahtarı yoktu). Kaynak `assets/src/logo-en.html`.
- MINI/MINOR göstergesi: jackpot panelinin solunda MİNİ, sağında MİNOR; değerler bahisle ölçekleniyor (bahis 1: 20/100, bahis 5: 100/500), tutan yanıp sönüyor. Olasılıklar gösterilmiyor (balığa göre değişiyor).

**Görseller ve performans**
- Arayüz görselleri WebP: 12,2 MB → 1,96 MB; yavaş ağda (4 Mbit) menü 30,3 sn yerine 10,7 sn'de açılıyor. PNG'ler düzenlenebilir kaynak olarak duruyor.
- Çizim çağrısı aynı yoğun sahnede 316 → 139-158: balık parçaları birleştirildi (klasik balık 8 → 3), coin/kıvılcım/mermi örneklenmiş çizim, nişan noktaları ve top mücevherleri tek çağrı.
- Yeni efektler: öldürmede şok halkası ve tiere göre renkli parçalar, namlu alevi, altın balıkta gövde parlaması ve dönen parıltılar.
- Manta baştan yapıldı (hilal kanatlar); balon balığına dikenler. Telefonda bloom gerçekten çeyrek çözünürlükte.
- Paralel bir oturum aynı sırada renk düzenini menü sanatına yaklaştırdı, kaplumbağa kabuğunu ve balık gölgelerini (tek çağrı) yeniledi.

**Temizlik**
- Kullanılmayan PNG'ler (`fish-starfish`, `fish-coin-sprite`, `fish-atlas-v1`) Çöp Sepeti'ne taşındı (`~/.Trash/balik-avi-unused-png/`); atlasın üretim prompt'u yerinde.
- **İlerleme Faz 1:** Gelgit döngüsü (sakin → dalga → boss → ödül), Balık Akını, Hazine Baloncuğu, HUD'da evre göstergesi. Tasarım ve ölçümler `docs/PROGRESSION.md` içinde.
- **İlerleme Faz 2:** XP (yakalanan balıktan), seviye, 5 top kaplaması, günlük 3 görev, günlük 2.500 bedava coin sınırı. Ayrıntı ve ölçümler `docs/PROGRESSION.md` §13.
- **İlerleme Faz 3:** Deniz haritası ve ikinci oda Batık Gemi (bahis 10-50, seviye 5 + 2.500 coin): 5 yeni prosedürel tür (Dev Ahtapot boss), batık gemi seti, oda sekmeli koleksiyon. Ayrıntı ve ölçümler `docs/PROGRESSION.md` §14.
- **İlerleme Faz 4:** Üçüncü oda Derin Deniz (bahis 50-200, seviye 15 + 12.500 coin; 4 yeni tür, Dev Kalamar boss), 3. turdan itibaren Boss Turu, Batık Gemi ve Derin Deniz'de Deniz Mayını. Ayrıntı `docs/PROGRESSION.md` §15.
- **Şimşek ve Buz Balığı:** Şimşek en kalabalık türden 8 balığı zincirle götürüyor, Buz bütün balıkları 5 sn donduruyor; ikisi de RTP-nötr. `docs/PROGRESSION.md` §16.

## 9. Genel QA turu (15 Ekim 2026, gece)

- **Demolar:** 33 demonun hepsi TR/EN × 1280×720, 1024×768, 844×390 (telefon taklidi) = 6 yapılandırmada hatasız çalıştı. Tek konsol hatası favicon 404'ü.
- **HUD çakışması:** Kasıtlı olanlar dışında yok. Bulunan tek kusur (4:3'te seviye çubuğunun duraklatma/sonuç çerçevesinin altından görünmesi) düzeltildi.
- **Performans (1280×720, 20 sn otomatik ateş):** Kare süresi ortanca 16,7 ms, p99 ~18 ms her üç odada. Çizim çağrısı ortalama 98-117, en yüksek 170. Üçgen en fazla 174 bin. HUD yazımı karede ortalama 1-2. JS belleği 37-48 MB.
- **Gerçek dokunmatik akış (telefon taklidi):** menü → harita → resif → 4 sn basılı tutarak ateş (22 atış, 3 yakalama) → duraklat → bitir → sonuç (Net −1, %87,5) → menü; kayıt (bakiye, XP, görev ilerlemesi) doğru yazıldı.
- **Açık kalanlar:** ~~Doku sayısı 121-170~~ → 80-91 (balık atlasları ve paylaşılan yüzey dokuları; ayrıntı aşağıda). Bütçe 60'ın hâlâ üstünde; tahmini doku belleği ~75 MB, mobil bütçe 128 MB. Boyut değişince HUD'ın bozulması (`HARNESS: hud-resize`, stüdyonun dosyası). Repoda `/vendor/` yok. Gerçek telefonda test yapılmadı.
- **Doku atlası (sonradan):** Balık derileri, yüzgeçleri ve gözleri üç atlasta; fırınlanmış malzemelerin pürüzlülük/kabartma haritaları tür başına paylaşılıyor (`src/game/kit.js`). GPU doku sayısı 152 → 80-91.
