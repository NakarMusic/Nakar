# Nakar

Türkçe şarkı tahmin oyunu — kısa bir bölümünü dinlediğin şarkıyı en az
denemede bil. Yanlış tahmin ve her atlama, dinlediğin süreyi biraz daha
uzatır (1 → 2 → 4 → 7 → 11 → 16 saniye), toplam 6 hakkın var.

## Özellikler

- **Üç oyun modu**
  - **Günlük** — herkesin aynı şarkıyı çözdüğü, 12 saatte bir yenilenen mod. Seri (streak) burada işler.
  - **Sınırsız** — bekleme yok, seçtiğin kategoride istediğin kadar oyna.
  - **Yarış** — 60 saniyede kaç şarkı bilebileceğini test et.
- **15 kategori** — yıllara göre (1980'ler–2020'ler), türlere göre (Türk Pop, Anadolu Rock, Arabesk, Türküler, Türkçe Rap, Slow & Damar), Dizi Müzikleri (jenerikten diziyi bil), Türkiye Top 100, Yeni Çıkanlar ve Günün Şarkısı.
- **İpucu sistemi** — her harcanan hak sırayla bir ipucu açar: kelime sayısı, ilk harf, dönem, sanatçı adı, baş harfler.
- Günlük seri, istatistik paneli, başarımlar, arşiv (kaçırılan günlük şarkıları oynama) ve sonucu tek dokunuşla paylaşma / arkadaşa meydan okuma linki.

## Nasıl çalıştırılır

Sadece statik dosyalardan oluşur; `index.html`'i doğrudan tarayıcıda açmak
`fetch()` ile veri/CSP kısıtları yüzünden çalışmaz — yerel bir sunucu
üzerinden servis etmen gerekir:

```bash
npx serve .
```

Sonra `http://localhost:3000` (veya terminalde gösterilen adres) üzerinden aç.

## Teknoloji yığını

- **Vanilla HTML + CSS + JavaScript** — framework yok, build adımı yok, sıfır runtime bağımlılığı.
- Fontlar self-host edilir (Space Grotesk, Manrope); harici CDN kullanılmaz.
- Şarkı önizlemeleri Deezer API'sinden (JSONP) anlık çekilir, hiçbir ses dosyası veya URL kalıcı olarak saklanmaz.
- Veri `data/*.json` altında kategori başına bir dosya olarak tutulur; `tools/` içindeki Node script'leri (`build-playlist.js`, `build-decades.js`, `validate.js`) veri kürasyonu için kullanılır, siteye dahil edilmez.
- Barındırma hedefi: GitHub Pages (statik).

Oyun mantığının ayrıntılı kuralları için `GAME-LOGIC.md` dosyasına bakabilirsin.
