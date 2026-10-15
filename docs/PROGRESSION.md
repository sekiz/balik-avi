# Balık Avı — İlerleme tasarımı (taslak)

Tarih: 15 Ekim 2026. Durum: **onaylandı. Dört fazın hepsi uygulandı** (bkz. §12-§15).

Bu doküman `threejs-gameplay-systems` skill'inin tasarım taslağı (design brief), çekirdek döngü sözleşmesi ve eğlence testleri üzerine kuruldu. Mevcut sayılar `src/economy/config.js`'ten.

---

## 0. Sorun

Bugünkü oyun skill'in eğlence testlerinden üçüne takılıyor:

| Test | Bugün |
|---|---|
| "Zorluk daha iyi kombinasyonlar değil, sadece daha çok şey" | 0-4. dk arası sadece balık sayısı (14 → 26) ve hız (+%25) artıyor. 4. dakikadan sonra hiçbir şey değişmiyor. |
| "Ödüller strateji, ilerleme ya da hissi değiştirmiyor" | Kazanılan coin bir sonraki oturumda hiçbir şeyi açmıyor. Koleksiyon ve tek günlük hedef var ama bunlar oyunu değiştirmiyor. |
| "Daha iyi oyuncu ne yapar?" sorusunun cevabı zayıf | Her balığın RTP'si aynı. Beceri yalnızca risk seçimi, zamanlama (kombo, fırtına) ve isabet. |

Hedef: oturum içinde **iniş-çıkış** (sürekli aynı yoğunluk değil), oturumlar arasında **ilerleme** (geri gelmek için sebep). RTP kuralına dokunmadan.

---

## 1. Tasarım taslağı (design brief)

- **Oyuncu vaadi:** "Okyanusun hazinesini topla: her oturumda biraz daha derine in, daha büyük balıkları avla."
- **Hedef his:** Hafif, ritmik avlanma; arada kalp atışını hızlandıran tepe anları (boss, akın, jackpot).
- **Ana fiil:** Nişan al ve ateş et.
- **Yan fiiller:** Bahis (mermi gücü) seç, hedef seç (küçük sık kazanç / büyük nadir kazanç), zamanla (kombo, fırtına, akın).
- **Her 5-30 saniyede tekrarlanan:** Nişan, ateş, isabet, öldürme, coin uçuşu, kombo.
- **1-5 dakikada değişen:** Dalga döngüsünün evreleri (sakin → yoğun → boss → ödül penceresi), etkinlikler, görevlerin ilerlemesi.
- **Kaybetme / öğrenme / yeniden başlama:** Coin biter, oturum özeti net sonucu gösterir, reklamla ya da ertesi günün bonusuyla geri dönülür. Yeni oturum anında başlar.
- **Ödül ve risk:** Ödül coin, XP, koleksiyon, görev; risk harcanan mermi. Büyük balık ve boss yüksek riskli, yüksek ödüllü.
- **Daha iyi oyuncu ne yapar:** Ödül pencerelerine (akın, fırtına) bakiye ayırır, kombo zincirini korur, bahsi evreye göre ayarlar, görev hedefine uygun balığı seçer.
- **Bir sonraki karar nasıl iletilir:** Boss geri sayımı (var), etkinlik uyarısı, görev göstergesi, oda kilidi göstergesi.
- **Kapsam dışı:** Çok oyunculu, PvP, ödüllü sıralama, coin'i paraya çevirme (yasal olarak hiçbir zaman).

**Çekirdek döngü sözleşmesi:**
Oyuncu **nişan alıp ateş ederek** **balık yakalar**; **sınırlı bakiye ve kaçan balıklar** risk yaratır. Başarı **coin, XP ve görev ilerlemesi** verir, başarısızlık **bakiye kaybettirir**. Oturum özeti ve ertesi günün ödülleri tekrar denemeye davet eder.

---

## 2. Üç zaman ölçeği

| Ölçek | Süre | Ne taşır | Durum |
|---|---|---|---|
| Atış | 0,2-2 sn | Nişan, isabet, öldürme, coin, kombo | Var |
| Oturum | 3-7 dk | Dalga döngüsü, etkinlikler, boss'lar | **Yeniden tasarlanacak (§3, §4)** |
| Meta | Günler, haftalar | XP ve seviye, odalar, görevler, koleksiyon | **Büyük kısmı yok (§5-§7)** |

---

## 3. Oturum yayı: "gelgit döngüsü"

Düz rampa yerine, kendini tekrar eden ve her turda biraz sertleşen bir döngü. Skill kuralı: "baskıdan sonra nefes alma alanı bırak."

| Evre | Süre | Ekranda | Amaç |
|---|---|---|---|
| **Sakin** | 40 sn | 12-14 balık, çoğu küçük, sürüler | Isınma, kombo kurma |
| **Yoğun** | 35 sn | 20-26 balık, orta ve büyük ağırlıklı, daha hızlı | Baskı, büyük av fırsatı |
| **Boss** | Boss ekrandan çıkana ya da ölene kadar (≈30-60 sn) | Boss + az sayıda küçük balık | Tepe anı. 5 sn önce geri sayım (zaten var) |
| **Ödül penceresi** | 15 sn | Boss öldüyse Altın Fırtına (var); ölmediyse küçük bir "Balık Akını" | Nefes ve tatmin |

- Bir tam döngü ≈ 2-2,5 dk. 5 dakikalık oturum ≈ 2 döngü.
- Her döngüde: boss sırası değişir (Altın Köpekbalığı → Deniz Ejderhası), "Yoğun" evresinde büyük balık oranı bir kademe artar.
- 3. döngüden sonra sertleşme durur (sonsuz zorluk yok, oturum zaten 3-7 dk).
- Yeni oyuncunun ilk dakikasındaki rehberli giriş (altın orta boy balık) korunur.

**RTP etkisi:** Yok. Sadece **ne zaman neyin** geldiği değişiyor; her balığın öldürme şansı aynı kural.

**Kod etkisi:** `WAVES` (config) evre tablosuna dönüşür; `EconomyService.tick` mevcut `ramp()` yerine evre makinesi çalıştırır. `features()` evre adını ve kalan süreyi döner (HUD için). Simülatör aynı servisle çalıştığı için RTP otomatik ölçülür.

---

## 4. Zamanlı etkinlikler

Her biri RTP-nötr olmak zorunda. Kural aynı: **ödülü M katına çıkaran şansı M'ye böler.**

| Etkinlik | Ne zaman | Ne olur | RTP'yi nasıl korur |
|---|---|---|---|
| **Balık Akını** | Döngü başına en çok bir kez, boss ölmediyse ödül penceresinde | 15 sn boyunca altın balık oranı %6 → %30, sürüler büyür | Altın balık zaten ×2/×3/×5 öder ve o kadar zor ölür; sadece sıklığı artıyor |
| **Boss Turu** | 3. döngüde bir kez | İki boss aynı anda (biri her zaman Altın Köpekbalığı) | Boss şansı aynı; sadece aynı anda iki hedef |
| **Hazine Baloncuğu** | Rastgele, oturumda 1-2 kez | Yavaş süzülen bir baloncuk; vurulunca ×10-30 öder | Normal bir "balık" gibi: şans = RTP ÷ ortalama çarpan |
| **Bomba Balığı** (daha sonra) | Nadir | Ölünce çevresindeki balıkları da öldürür, hepsinin toplamını öder | Şans = RTP ÷ (beklenen toplam ödül); sunucu yarıçaptaki balıkları sayarak hesaplar |

Uyarı: Etkinlikler 3-5 sn önceden HUD'da duyurulur (boss geri sayımıyla aynı yer). Bomba balığı sunucunun geometri bilmesini gerektirdiği için en sona kalır.

---

## 5. XP ve oyuncu seviyesi

**Öneri: XP harcanan coin'den değil, yakalanan balıktan gelsin.**

- Küçük 1 XP, orta 3, büyük 10, boss 50 (bahisten bağımsız).
- Neden: harcamadan gelen XP oyuncuyu daha yüksek bahse iter. Balıktan gelen XP bahis 1 ile bahis 10'u eşit ödüllendirir. Bu sorumlu oyun için doğru tercih ve mağaza denetiminde savunulabilir.

**Seviye eğrisi (taslak):** Seviye N için gereken XP = 60 × N^1,4 (1 → 60, 5 → 571, 10 → 1.507, 20 → 3.977).
Simülasyonla ölçüldü (400 oturum, 200 coin, bahis 1, rastgele nişan): ortanca oturum ≈ 1.700 atış ≈ 170 yakalama ≈ **320 XP**; her on oturumdan biri 115 XP'nin altında, biri 2.100'ün üstünde (boss yakalayanlar). İlk seviyeler oturum başına bir kez, 10. seviyeden sonra 4-5 oturumda bir.

**Seviye ödülleri:**

| Tür | Örnek | Ekonomi etkisi |
|---|---|---|
| Kozmetik | Top kaplamaları (bronz, gümüş, mercan, ejderha), mermi izi rengi | Yok |
| Oda kilidi | 5. seviye Batık Gemi, 15. seviye Derin Deniz | Yok (bkz. §6) |
| Küçük coin | Her seviyede 100-300 coin | **Bedava coin = pazarlama maliyeti** (bkz. §8) |
| Unvan / rozet | "Çırak avcı" → "Okyanus efsanesi" | Yok |

---

## 6. Odalar (denizler)

"Level" hissini veren ana katman. Her oda: ayrı görünüm, ayrı balık listesi, ayrı boss, ayrı bahis aralığı. **RTP her odada aynı** (%96,5); oda daha kârlı değil, sadece daha büyük bahisli ve görsel olarak farklı.

| Oda | Açılma | Bahisler | Yeni balıklar (öneri) | Boss |
|---|---|---|---|---|
| **Mercan Resifi** (bugünkü) | Baştan açık | 1, 2, 5, 10 | Bugünkü 13 tür | Altın Köpekbalığı, Deniz Ejderhası |
| **Batık Gemi** | Seviye 5 ve bakiye ≥ 1.000 | 10, 20, 50 | Fener balığı, ahtapot, deniz atı, barakuda | Hayalet Kaptan (ahtapot gemisi) |
| **Derin Deniz** | Seviye 15 ve bakiye ≥ 10.000 | 50, 100, 200 | Denizanası, yılan balığı, dev kalamar | Kraken |

- Bahis sınırı kuralı (bakiye ≥ 50 × bahis) her odada geçerli kalır.
- Oda seçimi menüdeki OYNA'dan önce bir "deniz haritası" ekranıyla yapılır.
- Koleksiyon oda başına sayfaya bölünür; bir odanın koleksiyonunu tamamlamak rozet ve kozmetik verir.

**Maliyet:** En pahalı katman. Oda başına bir arka plan görseli, 4-5 yeni tür (prosedürel ya da Tripo modeli; promptlar `docs/TRIPO-PROMPTS.md`'de), bir boss ve koleksiyon portreleri gerekiyor.

---

## 7. Görevler

Bugün tek bir günlük hedef var (`DAILY_GOALS`, 300-400 coin). Öneri:

- **Günlük 3 görev tahtası:** Biri kolay (50 balık), biri tür odaklı (5 büyük balık), biri etkinlik odaklı (bir akında 10 altın balık). Ödüller 150 / 250 / 400 coin ve XP.
- **Haftalık sandık:** 15 görev tamamlanınca kozmetik ya da coin.
- **Seri görseli:** Günlük giriş serisi (bugün var, 100 → 1.000) menüde 7 günlük şerit olarak görünür.
- Görevler **asla** "X coin harca" ya da "bahis 10'la oyna" olmaz (sorumlu oyun).

---

## 8. Ekonomi etkisi

RTP %96,5 sadece **atışlar** için geçerli. Bedava coin (günlük bonus, reklam, görev, seviye) atışların dışından gelir ve oyuncunun gerçek geri dönüşünü yükseltir.

Bugün bir oyuncunun günde alabileceği en fazla bedava coin:

| Kaynak | Günlük üst sınır |
|---|---|
| Günlük giriş bonusu | 100-1.000 (7 günlük merdiven) |
| Ödüllü reklam | 5 × 200 = 1.000 |
| Günlük hedef | 300-400 |
| **Toplam** | **≈ 1.400-2.400** |

Bu, başlangıç bakiyesinin (200) 7-12 katı. Yeni görevler ve seviye ödülleri bunu artıracak. Öneri:

- Bedava coin'i **günlük bir bütçeyle** sınırla (ör. günde en fazla 2.500, kaynak ne olursa olsun) ve simülatöre bir "oyuncu günü" modu ekle.
- Seviye ödüllerini ağırlıkla kozmetik tut.

---

## 9. Balık davranışları (his katmanı)

RTP'ye etkisi yok, sadece ekranda okunan hareket:

- Sürü vurulunca dağılır, 2 sn sonra toplanır.
- Büyük balık isabet alınca kısa süre hızlanıp kaçar.
- Boss'un fazları (yalnızca görsel): her 25 isabette renk değiştirir ve kükrer. Can çubuğu **yok**, çünkü her isabet bağımsız şans ve can çubuğu yanıltıcı ilerleme gösterir.

---

## 10. Uygulama sırası

| Faz | İçerik | Dosyalar | Sanat ihtiyacı | Tahmini kapsam |
|---|---|---|---|---|
| **1** | Gelgit döngüsü + Balık Akını + Hazine Baloncuğu + HUD'da evre göstergesi | `config.js`, `service.js`, `main.js`, `tools/rtp-sim.mjs` | Yok | 1 oturum |
| **2** | XP / seviye + 3'lü görev tahtası + seviye ekranı + kozmetik top kaplamaları | `config.js`, `service.js`, `main.js`, `cannon.js`, `i18n.js` | Top kaplamaları (prosedürel) | 1-2 oturum |
| **3** | Odalar: deniz haritası ekranı, Batık Gemi (arka plan, 4 tür, boss) | `world.js`, `fishmodels.js`, `config.js`, `main.js` | Arka plan görseli, tür modelleri, portreler | 2-3 oturum |
| **4** | Derin Deniz, Boss Turu, Bomba Balığı, balık davranışları | Aynı | Aynı | 2 oturum |

Her fazın kabul ölçütleri:
- Simülatörde her strateji için RTP %95-98 içinde kalıyor (mevcut ölçütle aynı).
- Ortanca oturum süresi bahis 1'de 3-7 dk arasında.
- Tarayıcıda gerçek girdiyle oynanıyor: evre geçişleri, etkinlik uyarıları ve görev ilerlemesi HUD'da görünüyor; masaüstü ve telefon boyutlarında çakışma yok.
- `state()` yeni alanları (evre, XP, seviye, görevler) küçük tutarak raporluyor; her yeni an için bir demo var.

---

## 11. Açık kararlar (senin onayın)

1. **XP kaynağı:** Yakalanan balık (önerilen, bahisten bağımsız) mı, harcanan coin mi?
2. **Odalar:** Üç oda ve yukarıdaki bahis aralıkları uygun mu? Oda açılması sadece seviyeyle mi, seviye + bakiye ile mi?
3. **Bedava coin bütçesi:** Günde en fazla ≈ 2.500 sınırı uygun mu?
4. **Yeni türlerin sanatı:** Prosedürel mi (hızlı, bugünkü tarz), Tripo modeli mi (daha zengin, anahtar ve kredi gerekiyor)?
5. **Başlangıç noktası:** Faz 1 (sanat gerektirmeyen oturum döngüsü) ile başlamak uygun mu?

**Karar (15 Ekim 2026):** Önerilerin hepsi onaylandı: XP yakalanan balıktan; üç oda, seviye + bakiye ile açılır; günlük bedava coin sınırı ≈ 2.500; yeni türler için sanat kararı Faz 3'te verilecek; Faz 1 ile başlandı.

---

## 12. Faz 1 — uygulandı (15 Ekim 2026)

- **Gelgit döngüsü** (`TIDE`, `src/economy/config.js`; `advanceTide`, `src/economy/service.js`): Sakin (ilk turda 25 sn, sonra 40) → Dalga (35 sn) → Boss → Ödül (15 sn). Tur ilerledikçe dalgadaki büyük balık oranı ve yüzme hızı artıyor (2 tura kadar). Boss'lar sırayla geliyor (Altın Köpekbalığı → Deniz Ejderhası).
- **Ödül penceresi:** Boss öldüyse Altın Fırtına (önceden vardı); kaçtıysa **Balık Akını**: 15 sn, gelen balıkların %30'u altın, büyük sürüler.
- **Hazine Baloncuğu:** Her turun sakin evresinde %50 olasılıkla bir kez; altın dolu açık sandık taşıyan yavaş bir baloncuk, ×10-20 öder. Koleksiyona girmez.
- **HUD:** Jackpot panelinin altında evre ve kalan süre ("Sakin sular · 0:21", "Dalga · 0:30", "BALIK AKINI · 0:11"); dalga, akın ve hazine için duyurular.
- **Demolar:** `fishTide`, `treasure` (ve önceki `bossWarn`).

**Ölçülenler:**
- Tarayıcıda 4 dakikalık oyun (stüdyo saatiyle) evreleri sırasıyla gösterdi: 0-25 sn sakin (10-12 balık, büyük yok) → 28-60 sn dalga (18-20 balık, 5'e kadar büyük) → 63 sn boss → 108 sn balık akını (altın balık 1 → 9) → 123 sn 2. tur sakin → 163 sn dalga (23 balık, 11'e kadar büyük) → 198 sn ikinci boss.
- Simülatör, 1M atış: rastgele %96,6, küçük balık %97,8, büyük balık %95,9, boss avcısı %97,3 (hedef bandı %95-98 içinde). Hazine baloncuğunun tek başına RTP'si %92-102 arası dalgalanıyor; az sayıda öldürme (111-793) olduğu için varyans.
- Oturum süresi (200 coin, sürekli ateş): bahis 1'de ortanca 4,3 dk (önce 5,0), en yüksek bahsi isteyen 2,4 dk (önce 2,7). Dalga evresi daha çok balık getirdiği için mermiler daha sık isabet ediyor.
- HUD çakışması yok (1280×720, 844×390); hata yok.

**Henüz yok (Faz 1 kapsamı dışı kaldı):** Boss Turu (iki boss birden, 3. turda) ve Bomba Balığı Faz 4'e kaldı.

---

## 13. Faz 2 — uygulandı (15 Ekim 2026)

- **XP:** Yakalanan balıktan (küçük 1, orta 3, büyük 10, boss 50; hazine baloncuğu büyük sayılır), bahisten bağımsız. Seviye N → N+1 için 60 × N^1,4 XP (`xpForLevel`).
- **Seviye ödülü:** Her seviyede 25 coin, her 5. seviyede 250 coin; 3, 6, 10, 15. seviyelerde top kaplaması (Gümüş, Mercan, Derinlik, Ejderha). Yeni kaplama açılınca topa hemen takılıyor; görev ekranından değiştirilebiliyor.
  - İlk denemede seviye başına 75-300 coin vardı: simülasyonda yeni oyuncunun ilk oturumu ortanca 4,3 dk'dan **15,6 dk'ya** çıktı (ilk oturumlarda 2-3 seviye atlanıyor). Ödül düşürüldü; şimdi bahis 1'de ortanca **5,6 dk**.
- **Görev tahtası:** Günde 3 görev (kolay / tür / etkinlik), güne göre seçiliyor (rastgelelik yok). Ödüller 150 / 250 / 400 coin ve 20 / 40 / 60 XP. Hiçbir görev harcama ya da bahis istemiyor. Gün dönünce bitmiş ama alınmamış görevler otomatik ödeniyor.
- **Bedava coin bütçesi:** Günlük bonus, reklam, görev ve seviye coin'leri birlikte günde en fazla **2.500**. Reklam hakkı, bütçe bir reklamı karşılamıyorsa düşüyor. Satın alma sınırlanmıyor.
- **Arayüz:** Menüde "GÖREVLER" (hazır görev sayısı kırmızı rozetle), görev ekranında seviye kartı, 3 görev ve 5 top kaplaması; oyun HUD'unda seviye, XP çubuğu ve ilk açık görev; seviye atlayınca afiş ve altın parıltı.

**Ölçülenler:**
- Simülatör 1M atış: RTP Faz 1 ile birebir aynı (%95,9-97,8); XP ve görevler atış sonucuna dokunmuyor.
- Node testi: 7. gün senaryosunda (1.000 bonus + 5 reklam + 3 görev = 2.800 istek) üçüncü görev 400 yerine 75 coin verdi, günlük toplam tam 2.500'de durdu. Yeni günde bütçe, reklam ve görevler sıfırlandı.
- Simüle edilmiş bir oturumda (bahis 1, 298 yakalama) oyuncu 4. seviyeye çıktı ve üç görevi de bitirdi.
- Tarayıcıda gerçek girdiyle (OYNA tıklaması, F ile otomatik ateş) 30 sn: 13 yakalama, 30 XP, görevler ilerledi. Görev ekranı TR/EN, 1280×720, 1024×768, 844×390'da çakışmasız.
- Kayıt: geçerli kayıt seviye/kaplama/görev/bütçe ile geri geliyor; bozuk ya da eski kayıt varsayılana dönüyor, hata yok.

---

## 14. Faz 3 — Batık Gemi uygulandı (15 Ekim 2026)

**Sanat:** Tripo ve Gemini anahtarları tanımlı olmadığı için her şey prosedürel. Anahtar eklenince türler `docs/TRIPO-PROMPTS.md` yoluyla modelle değiştirilebilir.

- **Oda tablosu** (`ROOMS`, config): Mercan Resifi (bahis 1/2/5/10, baştan açık) ve Batık Gemi (bahis 10/20/50; **seviye 5 ve 2.500 coin**). Her oda kendi tür listesi ve boss sırasıyla geliyor; RTP kuralı aynı.
  - Taslakta 1.000 coin vardı: simülatörde 1.000 coin'le 10'luk bahse giren oyuncu ortanca **1,9 dk**'da bitiyordu (10'luk bahiste 1.000 coin = resifte 1'lik bahiste 100 coin). 2.500'e çıkarıldı: ortanca **5,5 dk**.
- **Yeni türler (prosedürel):** Deniz Atı (küçük ×2-3), Barakuda (orta ×6-8), Fener Balığı (orta ×7-9; ışıklı yem, dişler), Ahtapot (büyük ×18-24; 8 dalgalanan kol), **Dev Ahtapot** (boss ×150-300; mor, parlayan benekler). Batık Gemi'de resiften Mavi Cerrah, Neon, Aslan, Balon, Köpekbalığı, Vatoz da yüzüyor; jackpot'u taşıyan Altın Köpekbalığı da boss sırasında.
- **Dünya:** `src/game/wreck.js`. Sol kenarda yan yatmış açık bir gövde (kaburgalar, raylar, direk kütüğü), üstte devrilmiş direk ve yırtık yelken, sağ altta çapa ve zincir, fıçılar, gemi topu, dökülmüş altınlar. Resifin parlak mercanları gizleniyor; su daha koyu ve yeşil. Parçalar kumun yüksekliğine (`sandY`) göre oturtuluyor.
- **Arayüz:** OYNA → **Deniz Haritası** (oda kartları, bahis aralığı, açılma şartları yeşil/kırmızı); koleksiyonda oda sekmesi; Batık Gemi'de 10 coin'in altına düşen oyuncuya "Mercan Resifi'ne dön"; topun namlu sayısı bahsin oda içindeki sırasından; 20 ve 50 için yeni renkler.
- **Portreler:** 5 yeni tür ve siluetleri, oyundaki modellerden render edildi (`portrait.html` yöntemi, NOTES'ta). İlk odanın yapay zekâ portrelerinden daha sade.

**Ölçülenler:**
- RTP, Batık Gemi, 2M atış, iki tohum: %95,95-97,85 (bant içinde). 600 bin atışta %99,5 çıkmıştı; Dev Ahtapot'un 95 öldürmelik örneği ve 50'lik bahisler varyansı büyütüyor.
- Resif, oda değişikliğinden sonra 1M atış: Faz 2 ile birebir aynı.
- Tarayıcıda gerçek girdiyle: menü OYNA → harita → Batık Gemi OYNA → F ile otomatik ateş: oda wreck, bahis 10, 12 sn'de 8 yakalama, 111 çizim çağrısı. "Coin bitti"den gerçek tıklamayla resife geçiş (bahis 1, bakiye korunarak).
- Harita, koleksiyon sekmesi, Batık Gemi ve Dev Ahtapot: TR/EN, 1280×720, 1024×768, 844×390'da HUD çakışması yok; hata yok.

**Sonradan düzeltilen:** Gemi gövdesi sol kenardaki kaya ve yosunların arkasında kalıyordu; Batık Gemi'de gövdenin önündeki kayalar ve yosunlar gizleniyor, gövdeye sıralar ve kopmuş tahtalar eklendi. Artık açıkça bir tekne olarak okunuyor. Derin Deniz odası, Boss Turu ve Bomba Balığı Faz 4'te.

---

## 15. Faz 4 — Derin Deniz, Boss Turu, Deniz Mayını uygulandı (15 Ekim 2026)

- **Derin Deniz** (üçüncü oda): bahis 50/100/200; **seviye 15 ve 12.500 coin**. Taslaktaki 10.000 ile 50'lik bahiste ortanca oturum 3,9 dk çıkıyordu; 12.500 (250 mermi, diğer odalarla aynı oran) ile 6,6 dk.
  - Yeni türler (prosedürel): Denizanası (küçük; parlayan çan, dalgalanan iplikler), Yılan Balığı (orta; kıvrılan gövde), Kalamar (büyük; ok ucu manto, yüzgeçler, iki uzun dokunaç), **Dev Kalamar** (boss ×200-400). Fener Balığı, Barakuda, Ahtapot, Neon ve Köpekbalığı da burada yüzüyor.
  - Dünya (`src/game/deep.js`): ışık neredeyse yok, sis kısa; kenarlarda ağzı turuncu parlayan hidrotermal bacalar, kırmızı uçlu tüp solucanları, mavi parlayan deniz kalemleri. Mercan ve yosun gizli, kayalar koyu, plankton biyolüminesans gibi parlıyor, kostik ışık %12'ye iniyor.
- **Boss Turu:** Her odada 3. turdan (tur 2, sıfırdan sayınca) itibaren boss evresinde odanın iki boss'u birden geliyor; afiş "BOSS TURU! İki boss birden!", HUD'da ikisinin adı ve ödül aralığı.
- **Deniz Mayını** (Batık Gemi ve Derin Deniz, dalga evresinde %60 olasılıkla): ×20-40 öder; patlayınca 7 birim içindeki boss olmayan en fazla 8 balığı götürür. **Götürülen balıklar ayrıca ödemez**; ödeme patlamanın kaç balık aldığından bağımsız olduğu için öldürme şansı her zamanki kural (RTP / ortalama çarpan) ve RTP kesin kalıyor. Sunucu `blast()` ile listeyi yalnızca bir mayın öldürüldükten hemen sonra kabul ediyor, boss ve özel hedefleri reddediyor (konumları doğrulamıyor: gerçek sunucuda geometri kontrolü gerekecek).

**Simülatör düzeltmesi:** Simülatörde boss'lar ekrandan hiç çıkmıyordu; "küçük balık" stratejisi ekranda küçük balık yokken boss'a ateş edip atışlarının üçte birini boss'lara harcıyordu (sonuçlar %94-98 arası savruluyordu). Oyundaki gibi 60 sn sonra ayrılıyorlar.

**Ölçülenler (2M atış, havuz dahil):** Resif %95,3-97,2 (küçük balıkçı havuz dahil %96,3), Batık Gemi %96,3-97,0, Derin Deniz %96,6-98,0. "Küçük balık" stratejisi havuzsuz %95,3-95,8 alıyor: Altın Köpekbalığı'nı hiç vurmadığı için her merminin havuza giden %1'ini geri almıyor (ilerleyen jackpot onu kovalayana gidiyor, tasarım gereği). Oturum (en küçük bahis): Resif 6,8, Batık Gemi 7,4, Derin Deniz 6,6 dk.
Tarayıcıda gerçek girdiyle: harita → Derin Deniz → otomatik ateş (bahis 50, 93 çizim çağrısı), koleksiyonda 3. sayfaya tıklama; harita, Derin Deniz, Boss Turu, mayın, Batık Gemi ve resif TR/EN, üç boyutta HUD çakışmasız ve hatasız.

---

## 16. Şimşek Balığı ve Buz Balığı (15 Ekim 2026)

- **Şimşek Balığı** (her odada, dalga evresinde %40): ×15-30 öder; vurulunca ekranda en kalabalık türden (boss değil) en yakın 8 balığa şimşek zinciri atlar, onları götürür. Mayındaki gibi götürülenler ayrıca ödemez; RTP kesin.
- **Buz Balığı** (her odada, sakin evrede %40): ×8-12 öder; vurulunca ekrandaki bütün balıklar 5 sn donar (buz mavisi, yerinde; donukken ekrandan da çıkamazlar). Hiçbir öldürme şansı değişmediği için RTP'ye etkisi yok.
- Özel hedefler tek bir tabloda (`EVENTS`, config): hazine, buz, mayın, şimşek; her biri hangi evrede, hangi olasılıkla, hangi odalarda.
- Şimşek efekti: zikzaklı, parlayan, titreyen yaylar; balıktan balığa sırayla atlar.

**Ölçülenler (2M atış):** Resif %95,3-97,2 (havuz dahil %95,8-97,2), Batık Gemi %95,7-96,8, Derin Deniz %94,8-97,7 (küçük balıkçı havuz dahil %95,8). Özel hedeflerin tek başına RTP'si %90-103 arası (her biri ~1.300-2.000 öldürmelik örnek: varyans). Oturumlar (en küçük bahis): 6,6 / 6,7 / 6,7 dk.
Tarayıcıda: şimşek demosu 8 neon balığını zincirle aldı, buz demosu 9-12 balığı dondurdu ve 5 sn sonra çözdü; masaüstü ve telefonda çakışmasız, hatasız.

**Rehber:** Koleksiyonun son sayfası "Özel Hedefler": dört özel hedefin portresi, ödülü, ne yaptığı, hangi odalarda ve hangi evrede çıktığı. Keşfedilecek bir şey olmadığı için hep açık.
