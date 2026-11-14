/**
 * Turkish translations, keyed by the exact English text the app renders (whitespace collapsed).
 * A string missing here stays in English. Proper names, product codes and data citations are kept as they are.
 */
export const TR: Record<string, string> = {
  // ---- App shell and top bar
  'Earth change explorer': 'Dünya değişim gezgini',
  'Investigations': 'Araştırmalar',
  'Filters': 'Filtreler',
  'Satellite layers': 'Uydu katmanları',
  'SAR lens': 'SAR merceği',
  'Coverage probe': 'Kapsama sondası',
  'About': 'Hakkında',
  'About Global SAR': 'Global SAR hakkında',
  'About Global SAR, data credits': 'Global SAR hakkında, veri kaynakları',
  'Map tools': 'Harita araçları',
  'Curated before/after investigations': 'Seçilmiş önce/sonra araştırmaları',
  'Categories, event catalogs and years': 'Kategoriler, olay katalogları ve yıllar',
  'Global satellite layers (NASA, ESA, partners)': 'Küresel uydu katmanları (NASA, ESA, ortaklar)',
  'A movable square that shows the same view in radar': 'Aynı görüntüyü radarla gösteren, taşınabilir bir kare',
  'Click the map to list real NISAR acquisitions there': 'Oradaki gerçek NISAR çekimlerini listelemek için haritaya tıklayın',
  'Swipe between before and after': 'Önce ile sonra arasında kaydırın',
  'Dismiss': 'Kapat',
  'Data package missing': 'Veri paketi eksik',
  'Coverage probe on: click anywhere on the globe': 'Kapsama sondası açık: kürede herhangi bir yere tıklayın',
  'SAR lens radar tiles': 'SAR merceği radar karoları',
  'satellite imagery': 'uydu görüntüleri',
  'labels and borders': 'etiketler ve sınırlar',
  'NISAR browse picture of the selected product': 'Seçili ürünün NISAR önizleme resmi',
  'NISAR investigation image': 'NISAR araştırma görüntüsü',
  'unknown error': 'bilinmeyen hata',
  'investigation footprint only': 'yalnızca araştırma alanı',
  'Global mosaic': 'Küresel mozaik',
  'This investigation': 'Bu araştırma',
  'Some map data failed to load: labels and borders, terrain. What you see may be incomplete; it does not mean there is no data.': 'Bazı harita verileri yüklenemedi: etiketler ve sınırlar, arazi. Gördüğünüz eksik olabilir; bu, verinin olmadığı anlamına gelmez.',
  'Language': 'Dil',
  'Switch to Turkish': 'Türkçeye geç',
  'Switch to English': 'İngilizceye geç',

  // ---- Welcome
  'NASA Space Apps Challenge 2026 · Dancing with the SARs': 'NASA Space Apps Challenge 2026 · Dancing with the SARs',
  'Global SAR: see how Earth changes, by radar': 'Global SAR: Dünya’nın nasıl değiştiğini radarla görün',
  'What it is': 'Nedir',
  'Global SAR is a 3D globe for exploring real radar observations of Earth, led by NISAR, the NASA and ISRO radar satellite. Radar sends its own signal, so it sees through clouds, smoke and darkness, and it can show things an ordinary photograph cannot: ground that moved by centimetres in an earthquake, or flood water hidden under storm clouds.':
    'Global SAR, Dünya’nın gerçek radar gözlemlerini keşfetmek için bir 3B küredir; başta NASA ile ISRO’nun radar uydusu NISAR olmak üzere. Radar kendi sinyalini gönderdiği için bulutların, dumanın ve karanlığın içini görür; sıradan bir fotoğrafın gösteremeyeceklerini gösterebilir: bir depremde santimetrelerce kayan zemini ya da fırtına bulutlarının altında saklı sel sularını.',
  'Who it is for': 'Kimin için',
  'Students and teachers, journalists, people who work on disasters and the environment, and anyone curious about how our planet changes. You do not need to know anything about radar: every investigation explains what you are looking at.':
    'Öğrenciler ve öğretmenler, gazeteciler, afet ve çevre alanında çalışanlar ve gezegenimizin nasıl değiştiğini merak eden herkes. Radar hakkında bir şey bilmeniz gerekmez: her araştırma neye baktığınızı açıklar.',
  'Please note: this is not a live emergency alert system. The investigations are our own analysis, not official NASA products, and every layer says whether it is an observation, a measurement we derived or an interpretation.':
    'Lütfen dikkat: bu canlı bir acil durum uyarı sistemi değildir. Araştırmalar resmî NASA ürünleri değil, bizim kendi analizimizdir; her katman bir gözlem mi, bizim türettiğimiz bir ölçüm mü yoksa bir yorum mu olduğunu belirtir.',
  'How to use it': 'Nasıl kullanılır',
  'How to use the tools': 'Araçlar nasıl kullanılır',
  'Drag to turn the globe, scroll or pinch to zoom, and hold the right mouse button (or use two fingers) to tilt.':
    'Küreyi döndürmek için sürükleyin, yakınlaştırmak için kaydırın ya da iki parmakla sıkıştırın, eğmek için farenin sağ tuşunu basılı tutun (veya iki parmak kullanın).',
  'Where the data comes from': 'Veriler nereden geliyor',
  'See the full credits': 'Tüm kaynakları görün',
  'Get started': 'Başlayın',
  'Five worked examples (an earthquake, a flood, a volcano, a forest clearing and a wildfire). Each compares radar images from before and after, with a timeline, and explains what you see at a Simple or Scientific level.':
    'Beş hazır örnek (bir deprem, bir sel, bir yanardağ, bir orman kesimi ve bir orman yangını). Her biri önceki ve sonraki radar görüntülerini bir zaman çizelgesiyle karşılaştırır ve gördüklerinizi Basit ya da Bilimsel düzeyde açıklar.',
  'Choose which kinds of events appear on the globe, switch on catalogs of past earthquakes, tsunamis, eruptions, fires, landslides and floods, and set a range of years. Click a marker to read its record.':
    'Kürede hangi tür olayların görüneceğini seçin; geçmiş depremlerin, tsunamilerin, püskürmelerin, yangınların, heyelanların ve sellerin kataloglarını açın ve bir yıl aralığı belirleyin. Kaydını okumak için bir işaretçiye tıklayın.',
  'Lay global satellite datasets over the globe, such as daily true-colour imagery, snow, flood water or night lights. Each layer has a colour legend that says what its colours mean and where that comes from.':
    'Günlük gerçek renkli görüntüler, kar, sel suyu ya da gece ışıkları gibi küresel uydu verilerini kürenin üzerine serin. Her katmanın, renklerin ne anlama geldiğini ve bunun kaynağını söyleyen bir renk açıklaması vardır.',
  'A square you can move and resize. Inside it the same place is shown in radar, from recent NISAR and Sentinel-1 passes. It can be expanded to the full screen.':
    'Taşıyıp boyutunu değiştirebileceğiniz bir kare. İçinde aynı yer, son NISAR ve Sentinel-1 geçişlerinden radarla gösterilir. Tam ekrana genişletilebilir.',
  'Click anywhere on Earth to list the real NISAR products recorded over that point, and view each one on its own: its picture and its footprint.':
    'O noktanın üzerinde kaydedilmiş gerçek NISAR ürünlerini listelemek için Dünya’da herhangi bir yere tıklayın ve her birini ayrı ayrı görün: resmini ve kapladığı alanı.',
  'Search': 'Ara',
  'Find a place, an investigation or a pair of coordinates and fly there.': 'Bir yer, bir araştırma ya da bir koordinat çifti bulun ve oraya uçun.',

  // ---- Guided tour (Welcome)
  'Global SAR introduction': 'Global SAR tanıtımı',
  'Skip tour': 'Turu atla',
  'Next': 'İleri',
  'Back': 'Geri',
  'Step 1 of 4: Welcome': 'Adım 1 / 4: Hoş geldiniz',
  'Step 2 of 4: Investigations': 'Adım 2 / 4: Araştırmalar',
  'Step 3 of 4: Tools': 'Adım 3 / 4: Araçlar',
  'Step 4 of 4: Before you start': 'Adım 4 / 4: Başlamadan önce',
  'A 3D globe for exploring real radar observations of Earth, led by NISAR, the NASA and ISRO radar satellite. Radar sends its own signal, so it can show what an ordinary photograph cannot.':
    'Dünya’nın gerçek radar gözlemlerini keşfetmek için bir 3B küre; başta NASA ile ISRO’nun radar uydusu NISAR olmak üzere. Radar kendi sinyalini gönderir, bu yüzden sıradan bir fotoğrafın gösteremediğini gösterebilir.',
  'Sees through clouds': 'Bulutların içini görür',
  'and smoke, when floods and fires hide from cameras': 've dumanın; seller ve yangınlar kameralardan saklandığında',
  'Works day and night': 'Gece gündüz çalışır',
  'because it brings its own signal': 'çünkü kendi sinyalini getirir',
  'Measures centimetres': 'Santimetreleri ölçer',
  'of ground motion after an earthquake': 'depremden sonraki zemin hareketinde',
  'Who it is for:': 'Kimin için:',
  'students and teachers, journalists, people who work on disasters and the environment, and anyone curious. No radar knowledge needed.':
    'öğrenciler ve öğretmenler, gazeteciler, afet ve çevre alanında çalışanlar ve merak eden herkes. Radar bilgisi gerekmez.',
  'Start with an investigation': 'Bir araştırmayla başlayın',
  'Five worked examples on real NISAR data. Each compares radar images from before and after an event, with a timeline, and explains what you see at a':
    'Gerçek NISAR verileriyle beş hazır örnek. Her biri bir olaydan önceki ve sonraki radar görüntülerini bir zaman çizelgesiyle karşılaştırır ve gördüklerinizi',
  'or': 'ya da',
  'level.': 'düzeyde açıklar.',
  'Drag the handle to swipe between before and after, or view them side by side.': 'Önce ile sonra arasında geçiş için tutamacı sürükleyin ya da ikisini yan yana görün.',
  'The five investigations': 'Beş araştırma',
  'Ground motion in centimetres': 'Santimetre cinsinden zemin hareketi',
  'New flood water under the clouds': 'Bulutların altındaki yeni sel suyu',
  'Lava fields over five months': 'Beş ay boyunca lav alanları',
  'Forest loss seen by HV radar': 'HV radarla görülen orman kaybı',
  'Burned canopy in Colorado': 'Colorado’da yanmış ağaç örtüsü',
  'Explore with the tools': 'Araçlarla keşfedin',
  'Every tool sits in the bar at the top of the screen.': 'Bütün araçlar ekranın üstündeki çubukta.',
  'Five worked examples, each comparing radar images from before and after.': 'Her biri önceki ve sonraki radar görüntülerini karşılaştıran beş hazır örnek.',
  'Choose event types, switch on catalogs and set a range of years.': 'Olay türlerini seçin, katalogları açın ve bir yıl aralığı belirleyin.',
  'Lay global datasets over the globe, each with a colour legend.': 'Küresel veri setlerini kürenin üzerine serin; her birinin bir renk açıklaması var.',
  'A movable square that shows the same place in radar.': 'Aynı yeri radarla gösteren, taşınabilir bir kare.',
  'Click anywhere to list the real NISAR products recorded there.': 'Orada kaydedilmiş gerçek NISAR ürünlerini listelemek için herhangi bir yere tıklayın.',
  'Find a place, an investigation or coordinates and fly there.': 'Bir yer, bir araştırma ya da koordinat bulun ve oraya uçun.',
  'Moving the globe': 'Küreyi hareket ettirme',
  'Drag': 'Sürükle',
  'turn the globe': 'küreyi döndürün',
  'Scroll': 'Kaydır',
  'or pinch to zoom': 'ya da yakınlaştırmak için iki parmakla sıkıştırın',
  'Right-drag': 'Sağ tuşla sürükle',
  'or two fingers to tilt': 'ya da eğmek için iki parmak',
  'Before you start': 'Başlamadan önce',
  'Please note': 'Lütfen dikkat',
  'Every layer carries a label': 'Her katmanın bir etiketi var',
  'Evidence labels': 'Kanıt etiketleri',
  'What a satellite recorded, shown as NASA published it.': 'Bir uydunun kaydettiği, NASA’nın yayımladığı hâliyle.',
  'A number our team computed from the radar, such as centimetres of motion.': 'Ekibimizin radardan hesapladığı bir sayı; örneğin santimetre cinsinden hareket.',
  'What we think it means, with the evidence and its limits.': 'Bunun ne anlama geldiğine dair görüşümüz; kanıtı ve sınırlarıyla birlikte.',
  'This is not a live emergency alert system. The investigations are our own analysis, not official NASA products.':
    'Bu canlı bir acil durum uyarı sistemi değildir. Araştırmalar resmî NASA ürünleri değil, bizim kendi analizimizdir.',
  'Every layer says whether it is an observation, a measurement we derived or an interpretation, and known limits are shown next to the results.':
    'Her katman bir gözlem mi, bizim türettiğimiz bir ölçüm mü yoksa bir yorum mu olduğunu belirtir; bilinen sınırlamalar sonuçların yanında gösterilir.',

  // ---- About / intro panel
  'NASA Space Apps 2026 · Dancing with the SARs': 'NASA Space Apps 2026 · Dancing with the SARs',
  'See what happened. Compare what changed. Understand what the radar sees.': 'Ne olduğunu görün. Neyin değiştiğini karşılaştırın. Radarın ne gördüğünü anlayın.',
  'Explore how Earth’s surface changes: geohazards, fire and forests, climate and ice, water, ecosystems and human activity. Investigations compare genuine satellite observations from before and after, led by NISAR, the NASA–ISRO radar that sees through clouds and darkness every 12 days. Every layer says whether it is an observation, a derived measurement or an interpretation.':
    'Dünya yüzeyinin nasıl değiştiğini keşfedin: jeolojik tehlikeler, yangın ve ormanlar, iklim ve buz, su, ekosistemler ve insan etkinliği. Araştırmalar, önceki ve sonraki gerçek uydu gözlemlerini karşılaştırır; başta, bulutların ve karanlığın içini 12 günde bir gören NASA–ISRO radarı NISAR olmak üzere. Her katman bir gözlem mi, türetilmiş bir ölçüm mü yoksa bir yorum mu olduğunu belirtir.',
  'Show the introduction again': 'Tanıtımı yeniden göster',
  'What data exists where?': 'Nerede hangi veri var?',
  'Turn on the probe, then click anywhere on Earth to list the real NISAR acquisitions over that point.': 'Sondayı açın, sonra o noktanın üzerindeki gerçek NISAR çekimlerini listelemek için Dünya’da herhangi bir yere tıklayın.',
  'Check NISAR coverage': 'NISAR kapsamasını kontrol et',
  'Coverage probe on: click the map': 'Kapsama sondası açık: haritaya tıklayın',
  'Probe another point': 'Başka bir noktayı sorgula',
  'Data credits': 'Veri kaynakları',
  'Radar imagery': 'Radar görüntüleri',
  'Context markers': 'Bağlam işaretçileri',
  'USGS (earthquakes M6.3+) and NASA EONET, past 12 months.': 'USGS (M6.3+ depremler) ve NASA EONET, son 12 ay.',
  'Globe imagery': 'Küre görüntüleri',
  'Terrain': 'Arazi',
  'Borders and place names': 'Sınırlar ve yer adları',
  'Interferometry: ground motion': 'İnterferometri: zemin hareketi',
  'Backscatter: water and surfaces': 'Geri saçılım: su ve yüzeyler',
  'Time series: change over months': 'Zaman serisi: aylar içindeki değişim',
  'Clear coverage': 'Kapsamayı temizle',
  '(list capped)': '(liste sınırlı)',
  '(in list)': '(listede)',
  'oldest listed': 'listelenen en eski',
  'Selected product': 'Seçili ürün',
  'Previous product (newer)': 'Önceki ürün (daha yeni)',
  'Next product (older)': 'Sonraki ürün (daha eski)',
  'Hide this product': 'Bu ürünü gizle',
  'NISAR products at this point': 'Bu noktadaki NISAR ürünleri',
  'NISAR data at this point': 'Bu noktadaki NISAR verileri',
  '‹ Prev': '‹ Önceki',
  'Next ›': 'Sonraki ›',
  'NASA published no browse picture for this product.': 'NASA bu ürün için önizleme resmi yayımlamadı.',
  'The map shows this product only: its footprint outline and this picture, placed on the footprint\'s bounding box (approximate, about a kilometre). NASA browse rendering: for looking, not measuring.':
    'Harita yalnızca bu ürünü gösteriyor: kapladığı alanın sınırını ve bu resmi, alanı çevreleyen kutuya yerleştirilmiş olarak (yaklaşık, bir kilometre kadar). NASA önizlemesi: bakmak içindir, ölçmek için değil.',
  'Choose a product to see its picture and footprint on the map. Only one product is drawn at a time.': 'Resmini ve kapladığı alanı haritada görmek için bir ürün seçin. Aynı anda yalnızca bir ürün çizilir.',
  'Live from the ASF DAAC search API. Pictures are NASA browse renderings of each product.': 'ASF DAAC arama API’sinden canlı. Resimler, her ürünün NASA önizlemeleridir.',
  'Searching the ASF archive for NISAR products…': 'ASF arşivinde NISAR ürünleri aranıyor…',
  'Close panel': 'Paneli kapat',
  'What satellites recorded here': 'Uyduların burada kaydettikleri',

  // ---- Investigations list
  'Before and after, from real NISAR radar observations.': 'Gerçek NISAR radar gözlemlerinden önce ve sonra.',
  'Ground motion': 'Zemin hareketi',
  'Surface change': 'Yüzey değişimi',
  'Time series': 'Zaman serisi',
  'Investigations list': 'Araştırma listesi',
  'Close investigations list': 'Araştırma listesini kapat',
  'EARTHQUAKE': 'DEPREM',
  'FLOOD': 'SEL',
  'VOLCANO': 'YANARDAĞ',
  'DEFORESTATION': 'ORMANSIZLAŞMA',
  'WILDFIRE': 'ORMAN YANGINI',

  // ---- Investigation names and places (events.json)
  'Venezuela earthquakes': 'Venezuela depremleri',
  'M7.5 and M7.2, north-central Venezuela': 'M7.5 ve M7.2, kuzey-orta Venezuela',
  'M7.2 epicentre': 'M7.2 merkez üssü',
  'Limpopo and Incomati floods': 'Limpopo ve Incomati selleri',
  'Southern Mozambique': 'Güney Mozambik',
  'Krasheninnikov volcano': 'Krasheninnikov yanardağı',
  'Kronotsky Reserve, Kamchatka, Russia': 'Kronotski Doğa Koruma Alanı, Kamçatka, Rusya',
  'Amazon clear-cut, União do Sul': 'Amazon’da orman kesimi, União do Sul',
  'Mato Grosso, Brazil · INPE DETER alert': 'Mato Grosso, Brezilya · INPE DETER uyarısı',
  'Aspen Acres wildfire': 'Aspen Acres orman yangını',
  'Custer County, Colorado, USA': 'Custer County, Colorado, ABD',
  'water mask': 'su maskesi',
  'water on both dates': 'her iki tarihte de su',
  'new water on 17 Jan': '17 Ocak’ta yeni su',
  'cm toward satellite (LOS)': 'uyduya doğru cm (görüş hattı)',
  'HH gamma0 (dB)': 'HH gamma0 (dB)',
  'HH change (dB), after - before': 'HH değişimi (dB), sonra - önce',
  'HV change (dB), after - before': 'HV değişimi (dB), sonra - önce',
  'HH change (dB), 28 Oct - 18 Jun': 'HH değişimi (dB), 28 Eki - 18 Haz',
  'Official NISAR browse image produced by the NISAR science data system (8-bit visualization, not calibrated values).': 'NISAR bilimsel veri sisteminin ürettiği resmî NISAR önizleme görüntüsü (8 bitlik görselleştirme, kalibre edilmiş değerler değil).',
  'Pure-black background pixels set transparent.': 'Saf siyah arka plan pikselleri saydam yapıldı.',
  'Reprojected bilinearly to Web Mercator (EPSG:3857).': 'Web Mercator’a (EPSG:3857) çift doğrusal olarak yeniden izdüşümlendi.',
  'Tropospheric delay, solid-earth tides and residual ionosphere NOT corrected.': 'Troposferik gecikme, katı yer gelgitleri ve artık iyonosfer DÜZELTİLMEDİ.',
  'Subtracted the product\'s ionospheric phase screen (included in GUNW but not applied by NASA).': 'Ürünün iyonosferik faz perdesi çıkarıldı (GUNW’de bulunur ama NASA tarafından uygulanmaz).',
  'Fixed display stretch -25 to 0 dB for both dates (comparable).': 'Her iki tarih için sabit görüntüleme aralığı -25 ile 0 dB (karşılaştırılabilir).',
  'Log-ratio change: 10*log10(after/before) on HH.': 'Log-oran değişimi: HH üzerinde 10*log10(sonra/önce).',
  'Scene-wide median HH change was +3.1 dB (land brightening, likely wetter soil and/or BETA calibration), which is why a change criterion is required.': 'Sahne genelindeki medyan HH değişimi +3,1 dB idi (karanın parlaması; muhtemelen daha ıslak toprak ve/veya BETA kalibrasyonu); bu yüzden bir değişim ölçütü gerekiyor.',
  'Heuristic classification, not validated in the field: wind-roughened water, radar shadow, smooth tarmac and very dry sand can be misclassified.': 'Arazide doğrulanmamış, sezgisel bir sınıflandırma: rüzgârla dalgalanan su, radar gölgesi, düz asfalt ve çok kuru kum yanlış sınıflandırılabilir.',
  'Cropped to 40 km around the event location.': 'Olay konumu çevresinde 40 km’ye kırpıldı.',
  'Cropped to 30 km around the event location.': 'Olay konumu çevresinde 30 km’ye kırpıldı.',
  'Cropped to 50 km around the event location.': 'Olay konumu çevresinde 50 km’ye kırpıldı.',
  'Scene-wide median HV change -1.19 dB removed before thresholding (moisture and/or calibration offset between dates).': 'Eşiklemeden önce sahne genelindeki medyan HV değişimi (-1,19 dB) çıkarıldı (tarihler arasındaki nem ve/veya kalibrasyon farkı).',
  'Scene-wide median HV change +0.37 dB removed before thresholding (moisture and/or calibration offset between dates).': 'Eşiklemeden önce sahne genelindeki medyan HV değişimi (+0,37 dB) çıkarıldı (tarihler arasındaki nem ve/veya kalibrasyon farkı).',

  // ---- Event panel
  'What happened': 'Ne oldu',
  'Source:': 'Kaynak:',
  'Compare': 'Karşılaştır',
  'COMPARE': 'KARŞILAŞTIR',
  'Comparison mode': 'Karşılaştırma modu',
  'Swipe': 'Kaydır',
  'Side by side': 'Yan yana',
  'Overlay': 'Üst üste',
  'Before': 'Önce',
  'After': 'Sonra',
  'BEFORE': 'ÖNCE',
  'AFTER': 'SONRA',
  'An interferogram is already a change measurement: it records motion between its two dates. Compare a pair that spans the event with one that doesn’t.':
    'Bir interferogram zaten bir değişim ölçümüdür: iki tarihi arasındaki hareketi kaydeder. Olayı kapsayan bir çifti, kapsamayan bir çiftle karşılaştırın.',
  'What the radar sees': 'Radarın gördüğü',
  'Explanation level': 'Açıklama düzeyi',
  'Simple': 'Basit',
  'Scientific': 'Bilimsel',
  'Legend': 'Renk açıklaması',
  'Look closer': 'Daha yakından bakın',
  'Radar basics': 'Radarın temelleri',
  'Data provenance': 'Verinin kaynağı',
  'References': 'Kaynakça',
  'LOS displacement (cm)': 'Görüş hattı yer değiştirmesi (cm)',
  'HH backscatter (dB)': 'HH geri saçılımı (dB)',
  'change (dB)': 'değişim (dB)',
  'L2 GCOV · geocoded backscatter': 'L2 GCOV · coğrafi konumlandırılmış geri saçılım',
  'L2 GUNW · geocoded unwrapped interferogram': 'L2 GUNW · coğrafi konumlandırılmış açılmış interferogram',
  'Before observation': 'Önceki gözlem',
  'After observation': 'Sonraki gözlem',
  'Close investigation': 'Araştırmayı kapat',
  'Other NASA data here': 'Burada başka NASA verileri',
  'Every NASA dataset covering this place around the event date (optical, thermal, rain, lidar…).': 'Olay tarihi civarında bu yeri kapsayan her NASA veri seti (optik, termal, yağış, lidar…).',
  'Search NASA Earthdata': 'NASA Earthdata’da ara',
  'Loading the NASA Earthdata search…': 'NASA Earthdata araması yükleniyor…',
  'NASA browse rendering': 'NASA önizlemesi',
  'computed by team': 'ekip tarafından hesaplandı',
  'Mission': 'Görev',
  'Product': 'Ürün',
  'Data tier': 'Veri düzeyi',
  'Acquired': 'Çekim',
  'Geometry': 'Geometri',
  'Granule': 'Granül',
  'Processed': 'İşlendi',
  'Distributor': 'Dağıtıcı',
  'browse image': 'önizleme görüntüsü',
  'full product': 'tam ürün',
  '(Earthdata login)': '(Earthdata girişi)',
  'Ask about this investigation': 'Bu araştırma hakkında sorun',
  'AI assistant, cites its sources': 'Yapay zekâ asistanı, kaynaklarını gösterir',
  'Loading the assistant…': 'Asistan yükleniyor…',
  'Derived measurement': 'Türetilmiş ölçüm',
  'Satellite observation': 'Uydu gözlemi',
  'Interpretation': 'Yorum',
  'Model output': 'Model çıktısı',
  'Simulation': 'Simülasyon',
  'PROVISIONAL': 'GEÇİCİ',
  'VALIDATED': 'DOĞRULANMIŞ',
  'BETA': 'BETA',
  'WHAT HAPPENED': 'NE OLDU',
  'WHAT THE RADAR SEES': 'RADARIN GÖRDÜĞÜ',
  'Before: cm toward satellite (LOS)': 'Önce: uyduya doğru cm (görüş hattı)',
  'Before: HH gamma0 (dB)': 'Önce: HH gamma0 (dB)',
  'Before: fixed calibrated composite (same scale every date)': 'Önce: sabit kalibre edilmiş bileşim (her tarihte aynı ölçek)',
  'Red + blue = HH, −25 → 0 dB': 'Kırmızı + mavi = HH, −25 → 0 dB',
  'Green = HV, −32 → −7 dB': 'Yeşil = HV, −32 → −7 dB',
  ': fixed calibrated composite (same scale every date)': ': sabit kalibre edilmiş bileşim (her tarihte aynı ölçek)',
  'After opacity': 'Sonraki görüntünün saydamlığı',
  'What the colours mean': 'Renkler ne anlama geliyor',
  'Data from': 'Veri tarihi:',
  'Snapshot from': 'Görüntü tarihi:',
  'Data package built': 'Veri paketi oluşturuldu:',
  'short explainers': 'kısa açıklamalar',
  'by NISAR SDS': 'NISAR SDS tarafından',
  'Terrain:': 'Arazi:',
  'Track': 'İz',
  'ascending': 'yükselen',
  'descending': 'alçalan',
  'event': 'olay',
  'BEFORE ·': 'ÖNCE ·',
  'AFTER ·': 'SONRA ·',
  '· AFTER': '· SONRA',
  '· track': '· iz',
  '· frame': '· çerçeve',
  '· HH backscatter (dB)': '· HH geri saçılımı (dB)',
  '· LOS displacement (cm)': '· görüş hattı yer değiştirmesi (cm)',
  '· change (dB)': '· değişim (dB)',
  '· water mask': '· su maskesi',
  'now': 'şu anda',
  'NISAR layers': 'NISAR katmanı',
  'NISAR scenes': 'NISAR sahnesi',
  'at': '·',
  'Set': 'Ayarlayın:',
  'with the Vite proxy, or': 'Vite vekil sunucusuyla, ya da',
  '(for example': '(örneğin',
  ', run': ', çalıştırın:',
  ', set': ', ayarlayın:',
  'VITE_ASSISTANT_GATEWAY_URL is not set.': 'VITE_ASSISTANT_GATEWAY_URL ayarlanmadı.',
  'USGS earthquake catalog': 'USGS deprem kataloğu',
  'Zoom in': 'Yakınlaştır',
  'Zoom out': 'Uzaklaştır',
  'Drag to rotate map, click to reset north': 'Haritayı döndürmek için sürükleyin, kuzeyi sıfırlamak için tıklayın',
  'Toggle attribution': 'Kaynak bilgisini aç/kapat',
  'Temperature, rain, wind and pressure at this point': 'Bu noktadaki sıcaklık, yağış, rüzgâr ve basınç',
  'at the event time': 'olay zamanında',
  ', from weather models.': ', hava modellerinden.',
  ', retrieved': ', alınma zamanı',
  '. Weather-model values for this point, not a satellite observation and not a measurement at a weather station.':
    '. Bu nokta için hava modeli değerleri; uydu gözlemi değil, bir hava istasyonundaki ölçüm de değil.',
  'The assistant does not guess or answer from a placeholder; it stays off until you connect a model.':
    'Asistan tahmin yürütmez ya da hazır bir metinle yanıt vermez; bir model bağlanana kadar kapalı kalır.',
  'Radar: NISAR (NASA/JPL-Caltech and ISRO), distributed by the Alaska Satellite Facility. Other layers and event records come from NASA (GIBS, FIRMS, EONET, the Global Landslide Catalog), USGS, NOAA, GDACS, the European Commission\'s JRC, the University of Maryland, Copernicus Sentinel imagery by EOX and OpenStreetMap.':
    'Radar: NISAR (NASA/JPL-Caltech ve ISRO), Alaska Satellite Facility tarafından dağıtılır. Diğer katmanlar ve olay kayıtları NASA (GIBS, FIRMS, EONET, Küresel Heyelan Kataloğu), USGS, NOAA, GDACS, Avrupa Komisyonu JRC, Maryland Üniversitesi, EOX’in Copernicus Sentinel görüntüleri ve OpenStreetMap’ten gelir.',
  'CC BY-NC-SA 4.0 for non-commercial use; commercial use needs an EOX licence': 'Ticari olmayan kullanım için CC BY-NC-SA 4.0; ticari kullanım için EOX lisansı gerekir',
  'Bright turquoise: snow and ice; high ice clouds': 'Parlak turkuaz: kar ve buz; yüksek buz bulutları',

  // ---- Legends of the investigations
  'Dark = little energy returned (smooth surfaces, radar shadow)': 'Koyu = az enerji döndü (düz yüzeyler, radar gölgesi)',
  'Very dark = little energy returned (open water, smooth surfaces)': 'Çok koyu = az enerji döndü (açık su, düz yüzeyler)',
  'Speckled noise = no coherent signal (water)': 'Benekli gürültü = uyumlu sinyal yok (su)',
  'Derived map: blue = away from the satellite, red = toward it (cm, see colour bar above)': 'Türetilmiş harita: mavi = uydudan uzağa, kırmızı = uyduya doğru (cm, yukarıdaki renk çubuğuna bakın)',
  'Each full cycle of colours is a contour step of motion toward or away from the satellite: about 42 cm in NASA’s rendering. Crowded bands = the ground moved a lot over a short distance.':
    'Renklerin her tam döngüsü, uyduya doğru ya da uydudan uzağa bir hareket basamağıdır: NASA’nın görüntüsünde yaklaşık 42 cm. Sıklaşan bantlar = zemin kısa bir mesafede çok hareket etti.',
  'Change layer: blue = HV dropped (canopy loss), red = HV rose': 'Değişim katmanı: mavi = HV düştü (ağaç örtüsü kaybı), kırmızı = HV arttı',
  'Change layer: blue = HV dropped (vegetation loss), red = HV rose': 'Değişim katmanı: mavi = HV düştü (bitki örtüsü kaybı), kırmızı = HV arttı',
  'Green = HV relatively strong (vegetation volume)': 'Yeşil = HV görece güçlü (bitki örtüsü hacmi)',
  'Green = HV strong (vegetation volume scattering)': 'Yeşil = HV güçlü (bitki örtüsünde hacim saçılımı)',
  'Green = HV strong (vegetation volume)': 'Yeşil = HV güçlü (bitki örtüsü hacmi)',
  'Green = HV strong (vegetation, forest canopy)': 'Yeşil = HV güçlü (bitki örtüsü, orman örtüsü)',
  'Magenta = HH relatively strong (surface / double bounce)': 'Eflatun = HH görece güçlü (yüzey / çift yansıma)',
  'Magenta = HH strong, HV weak (surface / double-bounce scattering)': 'Eflatun = HH güçlü, HV zayıf (yüzey / çift yansıma saçılımı)',
  'Pale/white = HH and HV both strong (rough surfaces, e.g. fresh lava)': 'Soluk/beyaz = HH ve HV ikisi de güçlü (pürüzlü yüzeyler, ör. taze lav)',
  'Colour shows which of two radar "listening" channels was stronger: green leans to HV (vegetation), pink/magenta leans to HH (surfaces, buildings, and plants standing in water). White = both strong.':
    'Renk, radarın iki "dinleme" kanalından hangisinin daha güçlü olduğunu gösterir: yeşil HV’ye (bitki örtüsü), pembe/eflatun HH’ye (yüzeyler, binalar ve suda duran bitkiler) yakındır. Beyaz = ikisi de güçlü.',
  'Every date uses the same colour scale, so a colour change means the ground really changed. Green = vegetation, pale/white = strong echoes from rough surfaces such as fresh lava, dark = smooth surfaces or slopes hidden from the radar.':
    'Her tarih aynı renk ölçeğini kullanır; bu yüzden bir renk değişimi zeminin gerçekten değiştiği anlamına gelir. Yeşil = bitki örtüsü, soluk/beyaz = taze lav gibi pürüzlü yüzeylerden gelen güçlü yankılar, koyu = düz yüzeyler ya da radardan gizli yamaçlar.',

  // ---- Simple explanations not covered above
  'The default view is our measurement of radar brightness on 5 and 17 January around Chókwè. Dark = the pulse bounced away, which is what calm water does.':
    'Varsayılan görünüm, Chókwè çevresinde 5 ve 17 Ocak’taki radar parlaklığı ölçümümüzdür. Koyu = darbe başka yöne yansıdı; durgun su böyle davranır.',
  'Pick “water mask” in the AFTER slot: bright blue = roughly 320–380 km² of new water on 17 January, mostly across the Limpopo floodplain and its irrigated fields. Muted blue = roughly 330–480 km² that was water on both dates (river channels, lakes, wetlands). The ranges come from two ways of smoothing the radar speckle.':
    'SONRA yuvasında “su maskesi”ni seçin: parlak mavi = 17 Ocak’ta, çoğu Limpopo taşkın ovası ve sulanan tarlaları boyunca, kabaca 320–380 km² yeni su. Soluk mavi = her iki tarihte de su olan kabaca 330–480 km² (nehir yatakları, göller, sulak alanlar). Aralıklar, radar beneklerini yumuşatmanın iki farklı yolundan geliyor.',
  'Pick “change (dB)” in the AFTER slot: blue = the forest echo dropped. Inside the box around INPE’s alert, 68 % of the ground shows a strong drop, against 11 % in the wider area.':
    'SONRA yuvasında “değişim (dB)”i seçin: mavi = orman yankısı düştü. INPE uyarısını çevreleyen kutunun içinde zeminin %68’i güçlü bir düşüş gösteriyor; daha geniş alanda bu oran %11.',
  'Pick “change (dB)” in the AFTER slot: blue = the vegetation echo dropped, which happens where fire destroyed trees and shrubs.':
    'SONRA yuvasında “değişim (dB)”i seçin: mavi = bitki örtüsü yankısı düştü; bu, yangının ağaçları ve çalıları yok ettiği yerlerde olur.',
  'Four NISAR passes from 15 June to 14 August 2026, on one fixed colour scale; the before/after pair is 27 June → 14 August.':
    '15 Haziran – 14 Ağustos 2026 arasında dört NISAR geçişi, tek bir sabit renk ölçeğinde; önce/sonra çifti 27 Haziran → 14 Ağustos.',
  'Krasheninnikov, a volcano in the Kronotsky Reserve of Kamchatka, began erupting on 2–3 August 2025, days after the M8.8 Kamchatka earthquake; its previous eruption was around 1550. Lava was still flowing onto its eastern flanks in late October 2026 (KVERT). NASA released a NISAR time-lapse of the lava flows.':
    'Kamçatka’nın Kronotski Doğa Koruma Alanı’ndaki bir yanardağ olan Krasheninnikov, M8.8 Kamçatka depreminden günler sonra, 2–3 Ağustos 2025’te püskürmeye başladı; önceki püskürmesi 1550 civarındaydı. Ekim 2026 sonunda lav hâlâ doğu yamaçlarına akıyordu (KVERT). NASA, lav akıntılarının NISAR ile hızlandırılmış bir videosunu yayımladı.',

  // ---- Scientific explanations and limitations
  'Co-polarized HH is dominated by surface and double-bounce scattering; cross-polarized HV arises mainly from multiple scattering in volumes (canopies). The HH/HV ratio helps separate bare ground, vegetation, urban areas and flooded vegetation (HH strongly enhanced by trunk–water double bounce).':
    'Eş polarizasyonlu HH’de yüzey ve çift yansıma saçılımı baskındır; çapraz polarizasyonlu HV ise esas olarak hacimlerdeki (ağaç örtüsü) çoklu saçılımdan doğar. HH/HV oranı çıplak zemini, bitki örtüsünü, kentsel alanları ve su basmış bitki örtüsünü (gövde–su çift yansımasıyla HH güçlü biçimde artar) ayırmaya yardımcı olur.',
  'Coherence (0–1) measures the correlation of the two complex images. Water surfaces decorrelate within milliseconds; vegetation, snow, and surface disruption reduce coherence. Low-coherence pixels carry no usable phase and must be masked.':
    'Uyum (0–1), iki karmaşık görüntünün korelasyonunu ölçer. Su yüzeyleri milisaniyeler içinde uyumunu kaybeder; bitki örtüsü, kar ve yüzeydeki bozulmalar uyumu düşürür. Düşük uyumlu piksellerde kullanılabilir faz yoktur ve maskelenmeleri gerekir.',
  'Radar brightness (backscatter, γ⁰) depends on surface roughness relative to the wavelength, geometry (local incidence angle) and dielectric properties (moisture). Specular reflection from smooth water gives very low γ⁰; dihedral double-bounce (walls, flooded trunks) gives very high γ⁰; volume scattering in canopies is intermediate and strongly depolarizing.':
    'Radar parlaklığı (geri saçılım, γ⁰), dalga boyuna göre yüzey pürüzlülüğüne, geometriye (yerel geliş açısı) ve dielektrik özelliklere (nem) bağlıdır. Düz sudan ayna yansıması çok düşük γ⁰ verir; iki yüzlü çift yansıma (duvarlar, su basmış gövdeler) çok yüksek γ⁰ verir; ağaç örtüsündeki hacim saçılımı ise ara düzeydedir ve polarizasyonu güçlü biçimde bozar.',
  'The interferometric phase Δφ = 4πΔR/λ links phase to line-of-sight (LOS) range change ΔR. With λ ≈ 24 cm for NISAR L-band, one 2π fringe corresponds to λ/2 ≈ 12 cm of LOS change. Phase also contains atmospheric, ionospheric and orbital terms that must be separated from ground motion.':
    'İnterferometrik faz Δφ = 4πΔR/λ, fazı görüş hattı (LOS) menzil değişimi ΔR’ye bağlar. NISAR L-bandı için λ ≈ 24 cm olduğundan bir 2π saçağı λ/2 ≈ 12 cm görüş hattı değişimine karşılık gelir. Faz ayrıca zemin hareketinden ayrılması gereken atmosferik, iyonosferik ve yörüngesel terimler içerir.',
  'Slopes facing away from the radar are in shadow, and slopes facing it are compressed (layover); both distort apparent brightness.':
    'Radara arkasını dönen yamaçlar gölgede kalır, radara bakan yamaçlar ise sıkışır (üst üste binme); ikisi de görünen parlaklığı bozar.',
  'Decorrelation over the Caribbean Sea and Lake Valencia shows where phase is meaningless; a coherence mask would remove these pixels.':
    'Karayip Denizi ve Valencia Gölü üzerindeki uyumsuzluk, fazın anlamsız olduğu yerleri gösterir; bir uyum maskesi bu pikselleri kaldırırdı.',
  'Derived by our team from NISAR data, not an official NASA product. Troposphere and solid-earth tides are not corrected; expect a few centimetres of error (pre-seismic noise: 3.5 cm standard deviation).':
    'Ekibimiz tarafından NISAR verilerinden türetildi, resmî bir NASA ürünü değildir. Troposfer ve katı yer gelgitleri düzeltilmedi; birkaç santimetrelik hata beklenebilir (deprem öncesi gürültü: 3,5 cm standart sapma).',
  'Derived by our team; heuristic threshold, not field-validated. Before and after scenes differ in processing version (PROVISIONAL vs VALIDATED).':
    'Ekibimiz tarafından türetildi; sezgisel eşik, arazide doğrulanmadı. Önceki ve sonraki sahnelerin işleme sürümleri farklı (GEÇİCİ ve DOĞRULANMIŞ).',
  'Derived by our team; heuristic threshold, not field-validated. No official burn perimeter was used for validation.':
    'Ekibimiz tarafından türetildi; sezgisel eşik, arazide doğrulanmadı. Doğrulama için resmî bir yangın sınırı kullanılmadı.',
  'Loss outside the polygon likely includes field preparation on existing farmland (soy planting season), which also lowers HV; this layer alone does not separate forest clearing from tillage.':
    'Poligon dışındaki kayıp muhtemelen mevcut tarım arazilerindeki tarla hazırlığını da (soya ekim mevsimi) içerir; bu da HV’yi düşürür. Bu katman tek başına orman kesimini toprak işlemeden ayırmaz.',
  'L-band HV is driven by woody volume scattering, so it maps crown-fire and woody canopy loss; surface fires in grass or shrubland are under-detected. Soil moisture from summer storms can raise γ⁰ and mask burn signals.':
    'L-bant HV’yi odunsu hacim saçılımı belirler; bu yüzden tepe yangınlarını ve odunsu ağaç örtüsü kaybını haritalar, çimen ya da çalılıktaki yüzey yangınları ise eksik tespit edilir. Yaz fırtınalarının getirdiği toprak nemi γ⁰’ı artırıp yangın izlerini maskeleyebilir.',
  'The bright, low-HV fan on the east-northeast flank of the cone is consistent with a rough lava field, matching KVERT reports of lava advancing on the east-northeast and east flanks of the Northern Cone. We infer this from backscatter only; it is an interpretation, not a mapped flow outline.':
    'Koninin doğu-kuzeydoğu yamacındaki parlak, düşük HV’li yelpaze pürüzlü bir lav alanıyla uyumludur ve KVERT’in Kuzey Koni’nin doğu-kuzeydoğu ve doğu yamaçlarında ilerleyen lav raporlarıyla örtüşür. Bunu yalnızca geri saçılımdan çıkarıyoruz; bu bir yorumdur, haritalanmış bir akıntı sınırı değildir.',
  'Sign convention follows ISCE3 (interferogram = reference × conj(secondary); positive phase = range increase), inferred from source code and consistent with right-lateral (westward) motion of the block south of the coastal fault for this ascending geometry and with NASA’s reported ~60 cm of westward motion. It is one look direction only, so east–west and vertical motion are mixed.':
    'İşaret kuralı ISCE3’ü izler (interferogram = referans × eşlenik(ikincil); pozitif faz = menzil artışı); kaynak koddan çıkarıldı ve bu yükselen geometri için kıyı fayının güneyindeki bloğun sağ yanal (batıya) hareketiyle ve NASA’nın bildirdiği ~60 cm batıya hareketle uyumludur. Tek bir bakış yönüdür; bu yüzden doğu–batı ve dikey hareket karışmıştır.',
  'Derived layers (default): LOS displacement d = −φ·λ/4π (λ = 24.20 cm from centerFrequency 1239 MHz) from GUNW unwrappedPhase minus the product’s ionospherePhaseScreen, masked where coherence < 0.3 or outside connected components, referenced to a far-field box (69.1–68.7°W, 9.8–10.0°N). Both pairs share one ±50 cm colour scale.':
    'Türetilmiş katmanlar (varsayılan): görüş hattı yer değiştirmesi d = −φ·λ/4π (λ = 24,20 cm, centerFrequency 1239 MHz’den), GUNW unwrappedPhase’den ürünün ionospherePhaseScreen’i çıkarılarak; uyumun < 0,3 olduğu ya da bağlı bileşenlerin dışında kalan yerler maskelendi, uzak alandaki bir kutuya (69,1–68,7°B, 9,8–10,0°K) göre referanslandı. İki çift de tek bir ±50 cm renk ölçeğini paylaşır.',
  'Derived layers: NISAR L2 GCOV γ⁰ HH and HV, track 060 descending, frame 061, ~22 × 20 km box; 3×3 boxcar, dB, composite R = B = HH (−25..0 dB), G = HV (−32..−7 dB) with one fixed stretch for all dates, unlike NASA’s per-image browse stretch. 2026-06-18 to 2026-10-16 PROVISIONAL, 2026-10-28 VALIDATED.':
    'Türetilmiş katmanlar: NISAR L2 GCOV γ⁰ HH ve HV, 060 alçalan iz, 061 çerçeve, ~22 × 20 km kutu; 3×3 kutu filtresi, dB, bileşim R = B = HH (−25..0 dB), G = HV (−32..−7 dB); NASA’nın görüntü başına önizleme ölçeğinden farklı olarak tüm tarihler için tek bir sabit ölçek. 2026-06-18 – 2026-10-16 GEÇİCİ, 2026-10-28 DOĞRULANMIŞ.',
  'Product: NISAR L2 GCOV (geocoded, terrain-flattened backscatter γ⁰), dual-pol HH/HV, track 114 ascending, frame 165. Browse composite per NISAR QA defaults: R = HH, G = HV, B = HH; each channel in linear power, clipped to its own 5th–95th percentile, gamma 0.5. Because each date is stretched independently, brightness is not comparable quantitatively between dates.':
    'Ürün: NISAR L2 GCOV (coğrafi konumlandırılmış, arazi düzeltmeli geri saçılım γ⁰), çift polarizasyonlu HH/HV, 114 yükselen iz, 165 çerçeve. NISAR QA varsayılanlarına göre önizleme bileşimi: R = HH, G = HV, B = HH; her kanal doğrusal güçte, kendi 5.–95. yüzdeliğine kırpılmış, gamma 0,5. Her tarih bağımsız olarak ölçeklendiği için parlaklık tarihler arasında nicel olarak karşılaştırılamaz.',
  'Product: NISAR L2 GUNW (geocoded unwrapped interferogram), track 162 ascending, frame 007. The browse image is the unwrapped phase rewrapped to [0, 7π) with a cyclic (twilight) colour map, per the NISAR QA software defaults. One colour cycle = 7π rad = 3.5 × λ/2 ≈ 42 cm of LOS change (λ ≈ 24.2 cm). The production rewrap value is recorded in the QA statistics file and could differ.':
    'Ürün: NISAR L2 GUNW (coğrafi konumlandırılmış açılmış interferogram), 162 yükselen iz, 007 çerçeve. Önizleme görüntüsü, NISAR QA yazılımı varsayılanlarına göre döngüsel (twilight) bir renk haritasıyla [0, 7π) aralığına yeniden sarılmış açılmış fazdır. Bir renk döngüsü = 7π rad = 3,5 × λ/2 ≈ 42 cm görüş hattı değişimi (λ ≈ 24,2 cm). Üretimdeki yeniden sarma değeri QA istatistik dosyasında kayıtlıdır ve farklı olabilir.',
  'NISAR L2 GCOV γ⁰ HH/HV, track 002 ascending, frame 172. HV (cross-pol) responds to canopy volume scattering; clearing removes it.':
    'NISAR L2 GCOV γ⁰ HH/HV, 002 yükselen iz, 172 çerçeve. HV (çapraz polarizasyon) ağaç örtüsündeki hacim saçılımına tepki verir; kesim bunu ortadan kaldırır.',

  // ---- Processing steps (provenance)
  'Converted phase to line-of-sight displacement: d = -phi * lambda / (4 pi), lambda = 24.20 cm from centerFrequency.': 'Faz görüş hattı yer değiştirmesine dönüştürüldü: d = -phi * lambda / (4 pi), lambda = 24,20 cm (centerFrequency’den).',
  'Masked pixels with coherence < 0.3 or outside valid unwrapping components.': 'Uyumu < 0,3 olan ya da geçerli açma bileşenlerinin dışında kalan pikseller maskelendi.',
  'Referenced to zero at the median of a far-field box (-69.1, 9.8, -68.7, 10.0) (W,S,E,N); only the unwrapping component containing that box is shown (other components have an unknown multiple-of-12-cm offset).':
    'Uzak alandaki bir kutunun (-69.1, 9.8, -68.7, 10.0) (B,G,D,K) medyanında sıfıra referanslandı; yalnızca o kutuyu içeren açma bileşeni gösteriliyor (diğer bileşenlerde 12 cm’nin katları olan bilinmeyen bir kayma var).',
  '3x3 boxcar on linear power; converted to dB.': 'Doğrusal güçte 3x3 kutu filtresi; dB’ye dönüştürüldü.',
  '5x5 boxcar speckle filter on linear power; converted to dB = 10*log10(gamma0).': 'Doğrusal güçte 5x5 kutu benek filtresi; dB = 10*log10(gamma0) olarak dönüştürüldü.',
  'Read gamma0 HHHH and HVHV (frequency A) for the area of interest via HTTPS range requests.': 'İlgi alanı için gamma0 HHHH ve HVHV (frekans A) HTTPS aralık istekleriyle okundu.',
  'Read gamma0 HHHH and HVHV (frequency A) for a ~22 x 20 km box around the summit via HTTPS range requests.': 'Zirve çevresinde ~22 x 20 km’lik bir kutu için gamma0 HHHH ve HVHV (frekans A) HTTPS aralık istekleriyle okundu.',
  'Read unwrappedPhase, coherenceMagnitude, connectedComponents and ionospherePhaseScreen (frequency A, HH) for the area of interest via HTTPS range requests.': 'İlgi alanı için unwrappedPhase, coherenceMagnitude, connectedComponents ve ionospherePhaseScreen (frekans A, HH) HTTPS aralık istekleriyle okundu.',
  'Composite R = B = HH, G = HV with one fixed stretch for every date (HH (-25.0, 0.0), HV (-32.0, -7.0) dB), so colours are comparable through time.': 'Bileşim R = B = HH, G = HV; her tarih için tek bir sabit ölçek (HH (-25.0, 0.0), HV (-32.0, -7.0) dB), böylece renkler zaman içinde karşılaştırılabilir.',
  'Composite R = B = HH, G = HV, with one fixed stretch for every date (HH (-25.0, 0.0), HV (-32.0, -7.0) dB, gamma 0.8), so colours are comparable through time.': 'Bileşim R = B = HH, G = HV; her tarih için tek bir sabit ölçek (HH (-25.0, 0.0), HV (-32.0, -7.0) dB, gamma 0.8), böylece renkler zaman içinde karşılaştırılabilir.',
  'NISAR L-band data: NASA/JPL-Caltech & ISRO, distributed by ASF DAAC. Derived layer computed by the Global SAR team.': 'NISAR L-bant verisi: NASA/JPL-Caltech ve ISRO, ASF DAAC tarafından dağıtılır. Türetilmiş katman Global SAR ekibi tarafından hesaplandı.',
  'NISAR L-band data: NASA/JPL-Caltech & ISRO, distributed by ASF DAAC': 'NISAR L-bant verisi: NASA/JPL-Caltech ve ISRO, ASF DAAC tarafından dağıtılır',
  'NISAR L-band, NASA/JPL-Caltech & ISRO, distributed by ASF DAAC.': 'NISAR L-bant, NASA/JPL-Caltech ve ISRO, ASF DAAC tarafından dağıtılır.',

  // ---- Layer panel notes
  'Swatches illustrate the colour names used in the NASA description; they are not sampled from a colour table (this layer has none). NASA advises consulting auxiliary data, because other land covers can have a similar appearance.':
    'Renk örnekleri NASA açıklamasında geçen renk adlarını gösterir; bir renk tablosundan alınmamıştır (bu katmanın tablosu yok). NASA, başka arazi örtülerinin de benzer görünebileceği için yardımcı verilere bakılmasını öneriyor.',
  'Swatches illustrate the colour names used in the NASA description; they are not sampled from a colour table (this layer has none). The red of a burn scar varies with the vegetation burned, the residue and how complete the burn was.':
    'Renk örnekleri NASA açıklamasında geçen renk adlarını gösterir; bir renk tablosundan alınmamıştır (bu katmanın tablosu yok). Bir yanık izinin kırmızısı, yanan bitki örtüsüne, kalıntıya ve yanmanın ne kadar tamamlandığına göre değişir.',
  'Substitute only the 4-digit year (YYYY) for {time}, not a full date. Mosaics blend many dates in each year, so they suit year-to-year change but not exact dating. Licence is non-commercial (CC BY-NC-SA 4.0). CORS echoes the request origin instead of \'*\'. Tested to z17 over Cairo; deeper zooms were not tested.':
    '{time} yerine tam tarih değil, yalnızca 4 haneli yılı (YYYY) yazın. Mozaikler her yıldaki birçok tarihi harmanlar; bu yüzden yıldan yıla değişim için uygundur, kesin tarihleme için değil. Lisans ticari olmayan kullanım içindir (CC BY-NC-SA 4.0). CORS, \'*\' yerine istek kaynağını geri döndürür. Kahire üzerinde z17’ye kadar test edildi; daha derin yakınlaştırmalar test edilmedi.',
  'CLICK A DATE TO SET': 'AYARLAMAK İÇİN BİR TARİHE TIKLAYIN',

  // ---- Timeline
  'Click a date to set': 'Ayarlamak için bir tarihe tıklayın',
  'Observation timeline': 'Gözlem zaman çizelgesi',
  'Which slot a click sets': 'Tıklamanın hangi yuvayı ayarladığı',
  ', current before': ', şu anki önce',
  ', current after': ', şu anki sonra',

  // ---- Weather
  'Weather here': 'Buradaki hava durumu',
  'WEATHER HERE': 'BURADAKİ HAVA DURUMU',
  'Get weather': 'Hava durumunu getir',
  'Getting weather data…': 'Hava durumu verileri alınıyor…',
  'Valid time': 'Geçerli zaman',
  'Air temperature (2 m)': 'Hava sıcaklığı (2 m)',
  'Precipitation, previous 24 h': 'Yağış, önceki 24 saat',
  'Wind speed (10 m)': 'Rüzgâr hızı (10 m)',
  'Sea-level pressure': 'Deniz seviyesi basıncı',
  'not available': 'mevcut değil',
  'Weather service returned an unexpected response': 'Hava durumu servisi beklenmeyen bir yanıt döndürdü',
  'Weather request failed': 'Hava durumu isteği başarısız oldu',
  'Open-Meteo historical weather (ECMWF ERA5 reanalysis)': 'Open-Meteo geçmiş hava durumu (ECMWF ERA5 yeniden analizi)',
  'Open-Meteo weather forecast models': 'Open-Meteo hava tahmin modelleri',
  'Meteomatics Weather API': 'Meteomatics Hava Durumu API’si',
  'Retry': 'Tekrar dene',

  // ---- Assistant
  'AI assistant': 'Yapay zekâ asistanı',
  'Assistant not connected': 'Asistan bağlı değil',
  'Checking assistant connection…': 'Asistan bağlantısı kontrol ediliyor…',
  'Check again': 'Yeniden kontrol et',
  'Full instructions:': 'Tüm talimatlar:',
  'Start the gateway with your model:': 'Ağ geçidini modelinizle başlatın:',
  'Restart': 'Yeniden başlatın',
  'Limitations': 'Sınırlamalar',
  'Thinking…': 'Düşünüyor…',
  'Ask the assistant': 'Asistana sorun',
  'Send': 'Gönder',
  'Observation': 'Gözlem',
  'Derived': 'Türetilmiş',
  'Reference': 'Kaynak',
  'The assistant gateway could not be reached.': 'Asistan ağ geçidine ulaşılamadı.',
  'No AI model is configured for this build, so there is nothing to answer questions yet.': 'Bu sürüm için bir yapay zekâ modeli ayarlanmadı, bu yüzden henüz soruları yanıtlayacak bir şey yok.',
  'map view': 'harita görünümü',
  'clicked point': 'tıklanan nokta',
  'The assistant could not answer.': 'Asistan yanıt veremedi.',
  'Request failed unexpectedly.': 'İstek beklenmedik şekilde başarısız oldu.',
  'Conversation': 'Konuşma',
  'You': 'Siz',
  'Assistant': 'Asistan',
  'Assistant unavailable:': 'Asistan kullanılamıyor:',
  'Error:': 'Hata:',
  'Citations': 'Alıntılar',
  'Ask about this scene…': 'Bu sahne hakkında sorun…',
  'none (no event selected)': 'yok (olay seçilmedi)',
  'Could not reach the assistant gateway.': 'Asistan ağ geçidine ulaşılamadı.',
  'Gateway is not reachable.': 'Ağ geçidine ulaşılamıyor.',
  'The assistant response did not match the contract and was discarded.': 'Asistanın yanıtı sözleşmeye uymadığı için atıldı.',

  // ---- Context (catalog event) panel
  'Satellite data here?': 'Burada uydu verisi var mı?',
  'Source': 'Kaynak',
  'Stored record': 'Kayıtlı kayıt',
  'Full record from the source API': 'Kaynak API’den tam kayıt',
  'Timeline': 'Zaman çizelgesi',
  'raw API response': 'ham API yanıtı',
  'Request failed': 'İstek başarısız oldu',
  'deaths reported': 'ölüm bildirildi',
  'Expand panel': 'Paneli genişlet',
  'Collapse panel': 'Paneli daralt',
  'Close event details': 'Olay ayrıntılarını kapat',
  'Satellite thermal detection': 'Uydu termal tespiti',
  'Reported event': 'Bildirilen olay',
  'Reported event from a catalog. Not analyzed or confirmed by satellite in this app.': 'Bir katalogdan bildirilen olay. Bu uygulamada uyduyla analiz edilmedi veya doğrulanmadı.',
  'Reported event (catalog record), not satellite-confirmed': 'Bildirilen olay (katalog kaydı), uyduyla doğrulanmadı',
  'Satellite observation (thermal detection)': 'Uydu gözlemi (termal tespit)',

  // ---- Earthdata
  'NASA Earthdata available here': 'Burada mevcut NASA Earthdata verileri',
  'No event date, so no time window to search.': 'Olay tarihi yok, bu yüzden aranacak bir zaman aralığı yok.',
  'Searching NASA CMR…': 'NASA CMR’de aranıyor…',
  'No NASA collections with granules found for this point and window.': 'Bu nokta ve zaman aralığı için granülü olan NASA koleksiyonu bulunamadı.',
  'Product page': 'Ürün sayfası',
  'Open this point and time in Earthdata Search': 'Bu noktayı ve zamanı Earthdata Search’te aç',
  'Close Earthdata panel': 'Earthdata panelini kapat',
  '· cloud-hosted': '· bulutta barındırılıyor',
  'Other platforms': 'Diğer platformlar',
  'Not provided': 'Belirtilmemiş',
  'NASA CMR did not respond in time. Try again.': 'NASA CMR zamanında yanıt vermedi. Tekrar deneyin.',

  // ---- Errors
  'The 3D globe could not start: this browser or device does not provide WebGL2.': '3B küre başlatılamadı: bu tarayıcı veya cihaz WebGL2 desteklemiyor.',
  'Try an up-to-date Chrome, Edge, Firefox or Safari, and check that hardware acceleration is turned on in the browser settings.': 'Güncel bir Chrome, Edge, Firefox veya Safari deneyin ve tarayıcı ayarlarında donanım hızlandırmanın açık olduğunu kontrol edin.',
  'Something went wrong and the app stopped.': 'Bir sorun oluştu ve uygulama durdu.',
  'Reload': 'Yeniden yükle',
  'network error': 'ağ hatası',
  'Search returned an unexpected response': 'Arama beklenmeyen bir yanıt döndürdü',
  'ASF returned an unexpected response': 'ASF beklenmeyen bir yanıt döndürdü',

  // ---- Filters
  'Years': 'Yıllar',
  'Analysis categories': 'Analiz kategorileri',
  'Event catalogs': 'Olay katalogları',
  'Recent events, 12 months (USGS, EONET)': 'Son olaylar, 12 ay (USGS, EONET)',
  'Satellite investigation in this app': 'Bu uygulamadaki uydu araştırması',
  'Reported event (USGS, NASA EONET): not satellite-confirmed here': 'Bildirilen olay (USGS, NASA EONET): burada uyduyla doğrulanmadı',
  'From year': 'Başlangıç yılı',
  'To year': 'Bitiş yılı',
  'Map filters': 'Harita filtreleri',
  'Close filters': 'Filtreleri kapat',
  'Hide': 'Gizle',
  'Show': 'Göster',
  ': older than 24 h, so these are not current fires.': ': 24 saatten eski, bu yüzden bunlar güncel yangınlar değil.',
  '(not live).': '(canlı değil).',
  'Geohazards': 'Jeolojik tehlikeler',
  'GEOHAZARDS': 'JEOLOJİK TEHLİKELER',
  'Fire & forests': 'Yangın ve ormanlar',
  'FIRE & FORESTS': 'YANGIN VE ORMANLAR',
  'Climate & cryosphere': 'İklim ve kriyosfer',
  'CLIMATE & CRYOSPHERE': 'İKLİM VE KRİYOSFER',
  'Water': 'Su',
  'WATER': 'SU',
  'Ecosystems': 'Ekosistemler',
  'ECOSYSTEMS': 'EKOSİSTEMLER',
  'Human activity': 'İnsan etkinliği',
  'HUMAN ACTIVITY': 'İNSAN ETKİNLİĞİ',
  'Earthquake': 'Deprem',
  'Volcano': 'Yanardağ',
  'Landslide': 'Heyelan',
  'Subsidence / uplift': 'Çökme / yükselme',
  'Tsunami': 'Tsunami',
  'Wildfire': 'Orman yangını',
  'Deforestation': 'Ormansızlaşma',
  'Vegetation change': 'Bitki örtüsü değişimi',
  'Glacier': 'Buzul',
  'Sea ice': 'Deniz buzu',
  'Permafrost': 'Donmuş toprak',
  'Coastal change': 'Kıyı değişimi',
  'Drought': 'Kuraklık',
  'Desertification': 'Çölleşme',
  'Flood': 'Sel',
  'Lake / reservoir': 'Göl / baraj gölü',
  'River change': 'Nehir değişimi',
  'Wetland': 'Sulak alan',
  'Habitat loss': 'Yaşam alanı kaybı',
  'Land degradation': 'Arazi bozulması',
  'Agricultural conversion': 'Tarıma dönüştürme',
  'Urban expansion': 'Kentsel genişleme',
  'Industrial': 'Sanayi',
  'Mining / quarry': 'Madencilik / taş ocağı',
  'Agriculture / irrigation': 'Tarım / sulama',
  'Transport infrastructure': 'Ulaşım altyapısı',
  'Energy infrastructure': 'Enerji altyapısı',
  'Land reclamation': 'Denizden arazi kazanımı',
  'Conflict damage': 'Çatışma hasarı',
  'Other human activity': 'Diğer insan etkinlikleri',
  'Active fires, last 24 h (NASA FIRMS)': 'Aktif yangınlar, son 24 saat (NASA FIRMS)',
  'Tsunamis since 1900 (NOAA NCEI)': '1900’den beri tsunamiler (NOAA NCEI)',
  'Earthquakes M7+ since 1900 (USGS)': '1900’den beri M7+ depremler (USGS)',
  'Significant eruptions since 1900 (NOAA NCEI)': '1900’den beri önemli püskürmeler (NOAA NCEI)',
  'Flood alerts since 2000 (GDACS)': '2000’den beri sel uyarıları (GDACS)',
  'Landslides (NASA Global Landslide Catalog)': 'Heyelanlar (NASA Küresel Heyelan Kataloğu)',

  // ---- Layers panel
  'Global datasets from NASA, ESA and partners, each live-checked. They show conditions, not a specific event.': 'NASA, ESA ve ortaklarından küresel veri setleri, her biri canlı olarak kontrol edildi. Belirli bir olayı değil, koşulları gösterirler.',
  'Layer catalog not available.': 'Katman kataloğu mevcut değil.',
  'Resolution': 'Çözünürlük',
  'Time': 'Zaman',
  'Licence': 'Lisans',
  'Checked': 'Kontrol edildi',
  'Close satellite layers': 'Uydu katmanlarını kapat',
  'No colour legend is available for this layer.': 'Bu katman için renk açıklaması yok.',
  'not officially documented': 'resmî olarak belgelenmemiş',

  // ---- SAR lens
  'SAR view:': 'SAR görünümü:',
  'SAR view provenance': 'SAR görünümünün kaynağı',
  'SAR view data provenance': 'SAR görünümü veri kaynağı',
  'SAR lens source': 'SAR merceği kaynağı',
  'Move SAR lens (drag, or use the arrow keys)': 'SAR merceğini taşı (sürükleyin veya ok tuşlarını kullanın)',
  'Resize SAR lens (drag, or use the arrow keys)': 'SAR merceğini yeniden boyutlandır (sürükleyin veya ok tuşlarını kullanın)',
  'Restore SAR lens to a square': 'SAR merceğini kareye döndür',
  'Expand SAR lens to full screen': 'SAR merceğini tam ekrana genişlet',
  'Close SAR lens': 'SAR merceğini kapat',
  'NISAR over Sentinel-1 radar': 'Sentinel-1 radarı üzerinde NISAR',
  'mosaic of recent daily passes, with gaps': 'son günlük geçişlerin mozaiği, boşluklarla',
  'Top: NISAR L2 GCOV, L-band 24 cm geocoded backscatter (NASA/JPL-Caltech and ISRO), daily tiles since 29 Oct 2025.': 'Üstte: NISAR L2 GCOV, L-bant 24 cm coğrafi konumlandırılmış geri saçılım (NASA/JPL-Caltech ve ISRO), 29 Eki 2025’ten beri günlük karolar.',
  'Beneath: OPERA L2 RTC-S1, Copernicus Sentinel-1 C-band 5.6 cm terrain-corrected backscatter (NASA JPL OPERA, ASF DAAC).': 'Altta: OPERA L2 RTC-S1, Copernicus Sentinel-1 C-bant 5,6 cm arazi düzeltmeli geri saçılım (NASA JPL OPERA, ASF DAAC).',

  // ---- Search
  'Search a place, event or lat, lon': 'Yer, olay ya da enlem, boylam arayın',
  'Search places, events or coordinates': 'Yer, olay ya da koordinat arayın',
  'Search results': 'Arama sonuçları',
  'Coordinates': 'Koordinatlar',
  'Unnamed place': 'Adsız yer',
  'Go to coordinates and check NISAR coverage': 'Koordinatlara git ve NISAR kapsamasını kontrol et',
  'Place search is unavailable right now. Coordinates still work, e.g. "10.5, -67.2".': 'Yer araması şu anda kullanılamıyor. Koordinatlar yine çalışır, ör. "10.5, -67.2".',

  // ---- Map
  'Interactive globe': 'Etkileşimli küre',
  'Globe: before view and event markers': 'Küre: önceki görünüm ve olay işaretçileri',
  'Globe: after view': 'Küre: sonraki görünüm',
  'Globe: SAR lens view': 'Küre: SAR merceği görünümü',

  // ---- Catalog record fields (eventDetails)
  'Type': 'Tür',
  'Date (UTC)': 'Tarih (UTC)',
  'Date precision': 'Tarih kesinliği',
  'Location': 'Konum',
  'Magnitude': 'Büyüklük',
  'Depth': 'Derinlik',
  'Size': 'Boyut',
  'Deaths reported': 'Bildirilen ölümler',
  'Detections': 'Tespitler',
  'Evidence': 'Kanıt',
  'Source link': 'Kaynak bağlantısı',
  'Notes': 'Notlar',
  'Record id': 'Kayıt numarası',
  'NOAA NCEI tsunami database': 'NOAA NCEI tsunami veritabanı',
  'Title': 'Başlık',
  'Place': 'Yer',
  'Magnitude type': 'Büyüklük türü',
  'Origin time': 'Oluş zamanı',
  'Record updated': 'Kayıt güncellendi',
  'Felt reports (DYFI)': 'Hissedilme bildirimleri (DYFI)',
  'Max reported intensity (CDI)': 'Bildirilen en yüksek şiddet (CDI)',
  'Max instrumental intensity (MMI)': 'Aletsel en yüksek şiddet (MMI)',
  'PAGER alert level': 'PAGER uyarı düzeyi',
  'Review status': 'İnceleme durumu',
  'Tsunami flag': 'Tsunami işareti',
  'Significance (0-1000+)': 'Önem (0-1000+)',
  'Preferred network': 'Tercih edilen ağ',
  'Event code': 'Olay kodu',
  'Associated ids': 'İlişkili numaralar',
  'Contributing networks': 'Katkıda bulunan ağlar',
  'Product types': 'Ürün türleri',
  'Stations used': 'Kullanılan istasyonlar',
  'Nearest station (deg)': 'En yakın istasyon (derece)',
  'RMS travel-time residual (s)': 'RMS seyahat süresi kalıntısı (s)',
  'Azimuthal gap (deg)': 'Azimut boşluğu (derece)',
  'Event type': 'Olay türü',
  'Timezone offset': 'Saat dilimi farkı',
  'Event page': 'Olay sayfası',
  'Detail feed': 'Ayrıntı akışı',
  'Hypocentre': 'Hiposantr',
  'Products': 'Ürünler',
  'EONET id': 'EONET numarası',
  'Description': 'Açıklama',
  'Status': 'Durum',
  'open (no end date recorded)': 'açık (bitiş tarihi kaydedilmedi)',
  'Categories': 'Kategoriler',
  'API record': 'API kaydı',
  'no link provided': 'bağlantı verilmedi',
  'position recorded': 'konum kaydedildi',
  'Observations': 'Gözlemler',
  'Sources': 'Kaynaklar',
  'Unknown': 'Bilinmiyor',
  'Questionable earthquake': 'Şüpheli deprem',
  'Earthquake and landslide': 'Deprem ve heyelan',
  'Volcano and earthquake': 'Yanardağ ve deprem',
  'Volcano, earthquake and landslide': 'Yanardağ, deprem ve heyelan',
  'Meteorological': 'Meteorolojik',
  'Explosion': 'Patlama',
  'Astronomical tide': 'Astronomik gelgit',
  'erroneous entry': 'hatalı kayıt',
  'event that only caused a seiche': 'yalnızca seiche oluşturan olay',
  'very doubtful': 'çok şüpheli',
  'NCEI event id': 'NCEI olay numarası',
  'Country': 'Ülke',
  'Area': 'Bölge',
  'Region code': 'Bölge kodu',
  'Latitude': 'Enlem',
  'Longitude': 'Boylam',
  'Cause': 'Neden',
  'Event validity': 'Olay geçerliliği',
  'Earthquake magnitude': 'Deprem büyüklüğü',
  'Earthquake depth (km)': 'Deprem derinliği (km)',
  'Max water height (m)': 'En yüksek su yüksekliği (m)',
  'Runup observations': 'Dalga tırmanma gözlemleri',
  'Tsunami intensity (Soloviev)': 'Tsunami şiddeti (Soloviev)',
  'Tsunami magnitude (Iida)': 'Tsunami büyüklüğü (Iida)',
  'Tsunami magnitude (Abe)': 'Tsunami büyüklüğü (Abe)',
  'Deaths': 'Ölümler',
  'Deaths (total, incl. source event)': 'Ölümler (toplam, kaynak olay dahil)',
  'Injuries': 'Yaralanmalar',
  'Injuries (total)': 'Yaralanmalar (toplam)',
  'Missing': 'Kayıplar',
  'Missing (total)': 'Kayıplar (toplam)',
  'Damage (million US$)': 'Hasar (milyon ABD$)',
  'Damage (million US$, total)': 'Hasar (milyon ABD$, toplam)',
  'Houses destroyed': 'Yıkılan evler',
  'Houses destroyed (total)': 'Yıkılan evler (toplam)',
  'Houses damaged': 'Hasar gören evler',
  'Houses damaged (total)': 'Hasar gören evler (toplam)',
  'Published': 'Yayımlandı',
  'Comments': 'Yorumlar',
  'Earthquake magnitude (Mw)': 'Deprem büyüklüğü (Mw)',
  'Earthquake magnitude (mb)': 'Deprem büyüklüğü (mb)',
  'Earthquake magnitude (Ms)': 'Deprem büyüklüğü (Ms)',
  'Earthquake magnitude (type unknown)': 'Deprem büyüklüğü (türü bilinmiyor)',
  'Warning status id': 'Uyarı durumu numarası',
  'Oceanic tsunami': 'Okyanus tsunamisi',
  'Linked NCEI earthquake id': 'Bağlı NCEI deprem numarası',
  'Linked NCEI volcano event id': 'Bağlı NCEI yanardağ olayı numarası',
  'NCEI reference ids': 'NCEI kaynak numaraları',
  'Date': 'Tarih',
  '(day or month not recorded)': '(gün veya ay kaydedilmedi)',
  'Unlisted cause': 'Listelenmemiş neden',
  'No per-event API is available for this catalog': 'Bu katalog için olay bazında bir API yok',

  // ---- Radar basics (explain.ts)
  'What is synthetic aperture radar?': 'Sentetik açıklıklı radar nedir?',
  'A radar satellite sends its own microwave pulses to the ground and records the echoes. Because it brings its own "light", it sees at night and straight through clouds and smoke.':
    'Bir radar uydusu yere kendi mikrodalga darbelerini gönderir ve yankıları kaydeder. Kendi "ışığını" getirdiği için gece de görür, bulutların ve dumanın içinden doğrudan görür.',
  'SAR synthesizes a long antenna by coherently combining echoes recorded along the orbit, giving metre-scale resolution from 747 km altitude. Each pixel stores amplitude (how much energy came back) and phase (the exact distance to the ground, modulo the wavelength).':
    'SAR, yörünge boyunca kaydedilen yankıları uyumlu biçimde birleştirerek uzun bir anten sentezler ve 747 km yükseklikten metre ölçeğinde çözünürlük sağlar. Her piksel genliği (ne kadar enerjinin geri döndüğü) ve fazı (dalga boyuna göre modüler olarak zemine olan tam mesafe) saklar.',
  'Bright and dark: backscatter': 'Parlak ve karanlık: geri saçılım',
  'Bright means a lot of the pulse bounced back to the satellite. Calm water acts like a mirror and sends the pulse away, so it looks black. Buildings act like corner reflectors and look very bright. Forests are medium-bright because the canopy scatters the pulse in all directions.':
    'Parlak, darbenin büyük kısmının uyduya geri yansıdığı anlamına gelir. Durgun su ayna gibi davranır ve darbeyi başka yöne gönderir, bu yüzden siyah görünür. Binalar köşe yansıtıcıları gibi davranır ve çok parlak görünür. Ormanlar orta parlaklıktadır, çünkü ağaç örtüsü darbeyi her yöne saçar.',
  'Polarization: HH and HV': 'Polarizasyon: HH ve HV',
  'NISAR sends pulses with a horizontal wave (H) and listens for both horizontal (HH) and vertical (HV) echoes. Only messy, three-dimensional targets like tree branches flip the wave to vertical, so HV is a "vegetation detector".':
    'NISAR yatay dalgalı (H) darbeler gönderir ve hem yatay (HH) hem dikey (HV) yankıları dinler. Dalgayı dikeye çeviren yalnızca ağaç dalları gibi dağınık, üç boyutlu hedeflerdir; bu yüzden HV bir "bitki örtüsü dedektörüdür".',
  'Interferometry: measuring motion': 'İnterferometri: hareketi ölçmek',
  'Compare the echo timing of two passes over the same place, 12 days apart. If the ground moved toward or away from the satellite, the echo arrives slightly earlier or later. The rainbow bands (fringes) are contour lines of that motion.':
    'Aynı yerin üzerinden 12 gün arayla yapılan iki geçişin yankı zamanlamasını karşılaştırın. Zemin uyduya doğru ya da uydudan uzağa hareket ettiyse yankı biraz daha erken ya da geç gelir. Gökkuşağı bantları (saçaklar) bu hareketin eş yükselti çizgileridir.',
  'Coherence: when the radar loses track': 'Uyum (koherans): radar izini kaybettiğinde',
  'Fringes only work where the ground looks the same in both passes. Water, moving leaves or a collapsed landscape scramble the echo, and the interferogram turns into random noise there.':
    'Saçaklar yalnızca zeminin iki geçişte de aynı göründüğü yerlerde işe yarar. Su, hareket eden yapraklar ya da çökmüş bir arazi yankıyı karıştırır ve interferogram orada rastgele gürültüye dönüşür.',
  'Why L-band matters': 'L-bant neden önemli',
  'NISAR uses long 24 cm waves, about four times longer than Europe’s Sentinel-1. Long waves slip past leaves and reach the ground, so NISAR can measure motion and floods under forests where shorter waves fail.':
    'NISAR, Avrupa’nın Sentinel-1 uydusundakinden yaklaşık dört kat uzun, 24 cm’lik dalgalar kullanır. Uzun dalgalar yaprakların arasından geçip zemine ulaşır; bu yüzden NISAR, kısa dalgaların başaramadığı orman altlarında hareketi ve selleri ölçebilir.',
  'Longer wavelength penetrates canopies and keeps interferometric coherence over vegetated and agricultural terrain for longer repeat intervals. The cost: L-band is more sensitive to the ionosphere, which adds long-wavelength phase ramps that must be estimated (e.g. by split-spectrum methods).':
    'Daha uzun dalga boyu ağaç örtüsünü geçer ve bitki örtülü ve tarım arazilerinde daha uzun tekrar aralıklarında interferometrik uyumu korur. Bedeli: L-bant iyonosfere daha duyarlıdır; bu da tahmin edilmesi gereken uzun dalga boylu faz rampaları ekler (ör. bölünmüş spektrum yöntemleriyle).',

  // ---- Venezuela (explain.ts)
  'On 24 June 2026 at about 22:04 UTC, two large earthquakes (M7.5 and M7.2) struck north-central Venezuela, near the coastal fault system that runs along the Caribbean shore. NASA used NISAR to map how far the ground shifted.':
    '24 Haziran 2026’da UTC 22:04 civarında, Karayip kıyısı boyunca uzanan kıyı fay sisteminin yakınında, kuzey-orta Venezuela’yı iki büyük deprem (M7.5 ve M7.2) vurdu. NASA, zeminin ne kadar kaydığını haritalamak için NISAR’ı kullandı.',
  'The default view is our measurement: how far the ground moved toward (red) or away from (blue) the satellite, in centimetres, computed from NISAR’s interferograms.':
    'Varsayılan görünüm bizim ölçümümüzdür: zeminin uyduya doğru (kırmızı) ya da uydudan uzağa (mavi) ne kadar hareket ettiği, santimetre cinsinden, NISAR interferogramlarından hesaplandı.',
  'BEFORE covers 1–13 June, with no earthquake: almost everything stays within a few centimetres (pale). AFTER covers 13–25 June: land south of the coast moved up to about 45 cm away from the satellite (deep blue).':
    'ÖNCE, deprem olmayan 1–13 Haziran’ı kapsar: hemen her şey birkaç santimetre içinde kalır (soluk). SONRA, 13–25 Haziran’ı kapsar: kıyının güneyindeki kara, uydudan yaklaşık 45 cm’ye kadar uzaklaştı (koyu mavi).',
  'Black gaps are places where the radar could not get a reliable measurement (water, steep mountains, dense vegetation).':
    'Siyah boşluklar, radarın güvenilir bir ölçüm alamadığı yerlerdir (su, dik dağlar, yoğun bitki örtüsü).',
  'Switch either slot to NASA’s rainbow pictures of the same data to see the raw interferometric fringes:':
    'Ham interferometrik saçakları görmek için iki yuvadan birini aynı verinin NASA gökkuşağı resimlerine çevirin:',
  'The tight bands along the coast appear only in the AFTER image. That is the earthquake. The wide, gentle bands appear in BOTH images, so they are not the earthquake.':
    'Kıyı boyunca sık bantlar yalnızca SONRA görüntüsünde görünür. Bu, depremdir. Geniş, yumuşak bantlar HER İKİ görüntüde de görünür; bu yüzden onlar deprem değildir.',
  'The speckled noise in the north is the Caribbean Sea: water never looks the same twice, so radar cannot measure it.':
    'Kuzeydeki benekli gürültü Karayip Denizi’dir: su hiçbir zaman iki kez aynı görünmez, bu yüzden radar onu ölçemez.',
  'Crowded fringes along the coast': 'Kıyı boyunca sıklaşan saçaklar',
  'The deepest blue in the AFTER map sits here, along the coast near the epicentres: the ground moved tens of centimetres away from the satellite. In NASA’s rainbow picture the colour bands crowd together here, and only after 24 June.':
    'SONRA haritasındaki en koyu mavi burada, merkez üslerine yakın kıyı boyuncadır: zemin uydudan onlarca santimetre uzaklaştı. NASA’nın gökkuşağı resminde renk bantları burada, yalnızca 24 Haziran’dan sonra, sıklaşır.',
  'The noise floor': 'Gürültü tabanı',
  'In the BEFORE map (no earthquake) the ground here still shows a few centimetres of apparent motion, and NASA’s rainbow pictures show wide gentle bands in BOTH pairs. That is the air and the ionosphere slightly delaying the radar signal, not the earthquake: about ±3.5 cm is our measurement noise.':
    'ÖNCE haritasında (deprem yok) buradaki zemin yine de birkaç santimetrelik görünür hareket gösteriyor ve NASA’nın gökkuşağı resimleri HER İKİ çiftte de geniş, yumuşak bantlar gösteriyor. Bu deprem değil, havanın ve iyonosferin radar sinyalini biraz geciktirmesidir: yaklaşık ±3,5 cm bizim ölçüm gürültümüzdür.',
  'Lake Valencia: noise': 'Valencia Gölü: gürültü',
  'A patch of noise inside the land: this is Lake Valencia. Water changes from second to second, so the radar cannot compare the two passes there.':
    'Karanın içinde bir gürültü lekesi: burası Valencia Gölü. Su saniyeden saniyeye değişir, bu yüzden radar oradaki iki geçişi karşılaştıramaz.',
  'Caribbean Sea: no signal': 'Karayip Denizi: sinyal yok',
  'All the speckle in the north is sea. No measurement is possible over water, which is why we only see motion on land.':
    'Kuzeydeki bütün benekler denizdir. Su üzerinde ölçüm mümkün değildir; bu yüzden hareketi yalnızca karada görürüz.',
  'Interferograms show motion along the radar line of sight only (one direction), not full 3-D motion.':
    'İnterferogramlar tam 3B hareketi değil, yalnızca radarın görüş hattı boyunca (tek yönde) hareketi gösterir.',
  'PROVISIONAL data tier: calibrated, but will be reprocessed by NASA in 2027.':
    'GEÇİCİ veri düzeyi: kalibre edildi, ancak NASA tarafından 2027’de yeniden işlenecek.',
  'NASA browse: one colour cycle ≈ 42 cm of line-of-sight motion (cyclic, 7π rad)':
    'NASA önizlemesi: bir renk döngüsü ≈ 42 cm görüş hattı hareketi (döngüsel, 7π rad)',
  'Pre-seismic pair (06-01 → 06-13): 1st–99th percentile −5.0 to +8.3 cm, standard deviation 3.5 cm, i.e. our noise floor (residual troposphere/ionosphere). Coseismic pair (06-13 → 06-25): 1st percentile −45 cm (away from the satellite), 99th +14.9 cm, standard deviation 12 cm. About half the area survives the coherence mask in each pair.':
    'Deprem öncesi çift (06-01 → 06-13): 1.–99. yüzdelik −5,0 ile +8,3 cm, standart sapma 3,5 cm; yani gürültü tabanımız (artık troposfer/iyonosfer). Deprem sırasındaki çift (06-13 → 06-25): 1. yüzdelik −45 cm (uydudan uzağa), 99. yüzdelik +14,9 cm, standart sapma 12 cm. Her çiftte alanın yaklaşık yarısı uyum maskesinden geçiyor.',
  'In the browse rendering, the coseismic pair shows a dense, coast-parallel fringe band peaking near the USGS epicentres, matching the steep displacement gradient in our derived map.':
    'Önizlemede deprem sırasındaki çift, USGS merkez üslerinin yakınında en yoğun hâle gelen, kıyıya paralel sık bir saçak bandı gösteriyor; bu, türettiğimiz haritadaki dik yer değiştirme eğimiyle örtüşüyor.',
  'Long-wavelength fringes present in both the pre-seismic (2026-06-01 → 06-13) and coseismic pairs are most plausibly ionospheric and tropospheric delay, to which L-band is particularly sensitive. They are not interpreted as deformation.':
    'Hem deprem öncesi (2026-06-01 → 06-13) hem deprem sırasındaki çiftlerde bulunan uzun dalga boylu saçaklar büyük olasılıkla, L-bandın özellikle duyarlı olduğu iyonosferik ve troposferik gecikmedir. Deformasyon olarak yorumlanmamıştır.',
  'Long-wavelength phase common to both pairs: likely ionospheric (dispersive, strong at L-band) plus tropospheric delay. Split-spectrum ionosphere correction and weather-model tropospheric correction would reduce it.':
    'İki çiftte ortak uzun dalga boylu faz: muhtemelen iyonosferik (dağıtıcı, L-bantta güçlü) artı troposferik gecikme. Bölünmüş spektrum iyonosfer düzeltmesi ve hava modeliyle troposfer düzeltmesi bunu azaltır.',
  'Temporal decorrelation of the water surface (coherence ≈ 0). Its position also checks our georeferencing of the browse image.':
    'Su yüzeyinin zamansal uyumsuzluğu (uyum ≈ 0). Konumu, önizleme görüntüsünü coğrafi konumlandırmamızı da doğrular.',

  // ---- Limpopo (explain.ts)
  'In January 2026, flooding along the Limpopo and Incomati rivers in southern Mozambique inundated floodplains and farmland. NASA compared NISAR observations from 5 and 17 January to map open water.':
    'Ocak 2026’da güney Mozambik’te Limpopo ve Incomati nehirleri boyunca yaşanan sel, taşkın ovalarını ve tarım arazilerini su altında bıraktı. NASA, açık suyu haritalamak için 5 ve 17 Ocak NISAR gözlemlerini karşılaştırdı.',
  'Pick “change (dB)” to see where it got darker (blue) or brighter (red). The whole area got a little brighter, most likely because rain wetted the soil: that is why we only count new water where the ground also got much darker.':
    'Nerelerin koyulaştığını (mavi) ya da parladığını (kırmızı) görmek için “değişim (dB)” seçin. Tüm alan biraz parladı, büyük olasılıkla yağmur toprağı ıslattığı için: bu yüzden yeni suyu yalnızca zeminin de çok koyulaştığı yerlerde sayıyoruz.',
  'Radar sees through the clouds that cover floods, which is why it is used in disasters like this.':
    'Radar selleri örten bulutların içini görür; bu yüzden böyle afetlerde kullanılır.',
  'Open water appears as very low backscatter in both channels (specular reflection). An HH increase relative to HV in vegetated floodplains can indicate flooded vegetation via trunk–water double bounce, which L-band detects beneath canopies.':
    'Açık su her iki kanalda da çok düşük geri saçılım olarak görünür (ayna yansıması). Bitki örtülü taşkın ovalarında HH’nin HV’ye göre artması, gövde–su çift yansımasıyla su basmış bitki örtüsüne işaret edebilir; L-bant bunu ağaç örtüsünün altında tespit eder.',
  'Derived layers: GCOV HHHH/HVHV read for 32.75–33.35°E, 24.35–24.85°S (3,370 km²), display layers use a 5×5 boxcar on linear power, classification a 3×3 median of dB (edge-preserving). The 17 Jan HH histogram is bimodal (water peak ≈ −18 dB, land ≈ −6 dB). Otsu gave −11.4 dB, biased by the much larger land class, so we use the centre of the histogram valley, −14.75 dB, after checking bimodality.':
    'Türetilmiş katmanlar: GCOV HHHH/HVHV, 32,75–33,35°D, 24,35–24,85°G (3.370 km²) için okundu; görüntüleme katmanları doğrusal güçte 5×5 kutu filtresi, sınıflandırma dB’nin 3×3 medyanını (kenar koruyucu) kullanır. 17 Ocak HH histogramı iki tepelidir (su tepesi ≈ −18 dB, kara ≈ −6 dB). Otsu, çok daha büyük kara sınıfının etkisiyle −11,4 dB verdi; bu yüzden iki tepeliliği kontrol ettikten sonra histogram vadisinin merkezini, −14,75 dB’yi kullanıyoruz.',
  'The 24 Dec 2025 scene on the timeline gives a pre-flood baseline on the identical geometry.':
    'Zaman çizelgesindeki 24 Ara 2025 sahnesi, aynı geometride selden önceki bir başlangıç noktası verir.',
  'Limpopo floodplain near Chókwè': 'Chókwè yakınındaki Limpopo taşkın ovası',
  'The Limpopo valley around Chókwè, a farming area that floods when the river overtops its banks. Compare how much of the valley floor is dark on each date.':
    'Chókwè çevresindeki Limpopo vadisi, nehir kıyılarından taştığında su basan bir tarım bölgesidir. Her tarihte vadi tabanının ne kadarının karanlık olduğunu karşılaştırın.',
  'Floodplain agriculture: expect γ⁰ to drop where fields become open water, and HH to rise where crops or shrubs stand in water.':
    'Taşkın ovası tarımı: tarlaların açık suya dönüştüğü yerlerde γ⁰’ın düşmesi, ekinlerin veya çalıların suda durduğu yerlerde HH’nin artması beklenir.',
  'Corumana reservoir (reference)': 'Corumana barajı (karşılaştırma için)',
  'A reservoir: permanent calm water, so it is dark on both dates. Use it as a reference for what water looks like to radar.':
    'Bir baraj gölü: kalıcı durgun su, bu yüzden her iki tarihte de karanlık. Suyun radara nasıl göründüğünü anlamak için bir referans olarak kullanın.',
  'BETA data tier: NASA states these early products are not fully calibrated and not intended for science. Relative patterns are still informative.':
    'BETA veri düzeyi: NASA bu erken ürünlerin tam kalibre edilmediğini ve bilimsel kullanım için olmadığını belirtiyor. Göreli desenler yine de bilgi verir.',
  'Flood areas are our heuristic classification, not field-validated. Compare with NASA’s open-water maps (SVS 5661) before quoting them.':
    'Sel alanları sezgisel sınıflandırmamızdır, arazide doğrulanmamıştır. Alıntılamadan önce NASA’nın açık su haritalarıyla (SVS 5661) karşılaştırın.',
  'Wind-roughened water and smooth surfaces such as tarmac can mimic or hide water in radar images.':
    'Rüzgârla dalgalanan su ve asfalt gibi düz yüzeyler radar görüntülerinde suyu taklit edebilir ya da gizleyebilir.',

  // ---- Amazon (explain.ts)
  'Radar sees through the clouds of the rainy season, when optical satellites often cannot.':
    'Radar, optik uyduların çoğu zaman göremediği yağmur mevsiminde bulutların içini görür.',
  'Strong HV loss: 35.7 km² of 336 km² analysed. Within the DETER polygon’s bounding box (16.8 km², containing the 6.2 km² polygon) 11.4 km² (68 %) show loss, versus 11 % overall: the radar change concentrates where INPE mapped the clear-cut.':
    'Güçlü HV kaybı: analiz edilen 336 km²’nin 35,7 km²’si. DETER poligonunu çevreleyen kutuda (16,8 km², 6,2 km²’lik poligonu içerir) 11,4 km² (%68) kayıp gösteriyor; genelde ise %11: radar değişimi INPE’nin orman kesimini haritaladığı yerde yoğunlaşıyor.',
  'INPE DETER clear-cut alert': 'INPE DETER orman kesimi uyarısı',
  'Centre of the area INPE flagged as freshly cleared forest (6.2 km²). The radar echo from the canopy dropped sharply here.':
    'INPE’nin yeni kesilmiş orman olarak işaretlediği alanın merkezi (6,2 km²). Ağaç örtüsünden gelen radar yankısı burada keskin biçimde düştü.',
  'HV also drops with tillage and drying vegetation, so loss outside the alert polygon is not necessarily deforestation.':
    'HV, toprak işleme ve kuruyan bitki örtüsüyle de düşer; bu yüzden uyarı poligonu dışındaki kayıp mutlaka ormansızlaşma değildir.',
  'In late September to mid-October 2026, about 6.2 km² of Amazon forest near União do Sul (Mato Grosso, Brazil) was clear-cut. Brazil’s INPE detected it with its DETER satellite alert system on 14 October 2026; Sentinel-2 imagery shows the forest still intact on 26 September, so the clearing happened between 26 September and 14 October.':
    'Eylül 2026 sonu ile Ekim ortası arasında União do Sul (Mato Grosso, Brezilya) yakınında yaklaşık 6,2 km² Amazon ormanı tamamen kesildi. Brezilya’nın INPE kurumu bunu 14 Ekim 2026’da DETER uydu uyarı sistemiyle tespit etti; Sentinel-2 görüntüleri ormanın 26 Eylül’de hâlâ sağlam olduğunu gösteriyor, yani kesim 26 Eylül ile 14 Ekim arasında yapıldı.',
  'Four NISAR passes, 18 September to 24 October 2026, on one fixed colour scale: green = forest (the radar echo bounces around inside the canopy), pink/dark = open ground.':
    '18 Eylül – 24 Ekim 2026 arasında dört NISAR geçişi, tek bir sabit renk ölçeğinde: yeşil = orman (radar yankısı ağaç örtüsünün içinde yansır durur), pembe/koyu = açık zemin.',

  // ---- Aspen Acres (explain.ts)
  'The Aspen Acres fire burned in Custer County, Colorado, from late June 2026 (NASA EONET / IRWIN record dated 29 June 2026), with a reported size of 91,982 acres (about 372 km²).':
    'Aspen Acres yangını, Haziran 2026 sonundan itibaren Colorado’nun Custer County bölgesinde yandı (29 Haziran 2026 tarihli NASA EONET / IRWIN kaydı); bildirilen büyüklüğü 91.982 akre (yaklaşık 372 km²).',
  'NASA EONET (IRWIN record)': 'NASA EONET (IRWIN kaydı)',
  'The radar shows about 68 km² of strong canopy loss. That is smaller than the 372 km² reported fire area, because grass and low shrub fires change the radar echo much less than burned forest.':
    'Radar yaklaşık 68 km² güçlü ağaç örtüsü kaybı gösteriyor. Bu, bildirilen 372 km²’lik yangın alanından küçüktür; çünkü çimen ve alçak çalı yangınları radar yankısını yanmış ormana göre çok daha az değiştirir.',
  'NISAR L2 GCOV γ⁰ HH/HV, track 019 ascending, frame 021, all PROVISIONAL (P05023). Change pair 2026-06-27 → 2026-08-14.':
    'NISAR L2 GCOV γ⁰ HH/HV, 019 yükselen iz, 021 çerçeve, tümü GEÇİCİ (P05023). Değişim çifti 2026-06-27 → 2026-08-14.',
  'HV log-ratio on a 3×3 median of dB, scene median (+0.37 dB) removed, threshold −3 dB: 68.1 km² of 1,539 km² analysed.':
    'dB’nin 3×3 medyanı üzerinde HV log-oranı, sahne medyanı (+0,37 dB) çıkarıldı, eşik −3 dB: analiz edilen 1.539 km²’nin 68,1 km²’si.',
  'EONET fire location': 'EONET yangın konumu',
  'The reported location of the Aspen Acres fire, which the incident record describes as about 20 miles south-west of Pueblo.':
    'Aspen Acres yangınının bildirilen konumu; olay kaydı bunu Pueblo’nun yaklaşık 20 mil güneybatısı olarak tanımlıyor.',
  'Reported fire area (372 km²) and radar canopy-loss area (68 km²) measure different things.':
    'Bildirilen yangın alanı (372 km²) ile radarla ölçülen ağaç örtüsü kaybı alanı (68 km²) farklı şeyleri ölçer.',

  // ---- Krasheninnikov (explain.ts)
  'Eleven NISAR passes on the same orbit, 12 days apart, from 18 June to 28 October 2026, processed by us at full resolution (about 20 m). Step through them on the timeline.':
    '18 Haziran – 28 Ekim 2026 arasında, aynı yörüngede, 12 gün arayla on bir NISAR geçişi; tarafımızdan tam çözünürlükte (yaklaşık 20 m) işlendi. Zaman çizelgesinde aralarında gezinin.',
  'Look at the pale fan on the east side of the summit cone: that is where the Kamchatka volcano observatory (KVERT) reported lava flowing.':
    'Zirve konisinin doğu tarafındaki soluk yelpazeye bakın: Kamçatka yanardağ gözlemevinin (KVERT) lav aktığını bildirdiği yer orası.',
  'Radar keeps watching through cloud and polar night, which is common over Kamchatka.':
    'Radar, Kamçatka’da sık görülen bulutlara ve kutup gecesine rağmen izlemeye devam eder.',
  'NASA’s Dec 2025 – Jan 2026 passes used in its time-lapse are not yet publicly released, so the eruption’s early months are not in this series.':
    'NASA’nın hızlandırılmış videosunda kullandığı Ara 2025 – Oca 2026 geçişleri henüz kamuya açılmadı; bu yüzden püskürmenin ilk ayları bu seride yok.',
  'Krasheninnikov summit': 'Krasheninnikov zirvesi',
  'The volcano’s summit, inside its old caldera.': 'Yanardağın eski kalderasının içindeki zirvesi.',
  'Pale fan east of the cone': 'Koninin doğusundaki soluk yelpaze',
  'A bright fan on the east side of the cone, on every date. Rough new lava reflects radar strongly, and this is where KVERT reported lava flows.':
    'Koninin doğu tarafında, her tarihte görülen parlak bir yelpaze. Pürüzlü yeni lav radarı güçlü biçimde yansıtır ve KVERT’in lav akıntıları bildirdiği yer burasıdır.',
  'High HH and HV with no vegetation signature: consistent with a rough aʻa-type lava surface. Interpretation supported by KVERT reports, not an outline of the flow.':
    'Bitki örtüsü izi olmadan yüksek HH ve HV: pürüzlü aʻa tipi bir lav yüzeyiyle uyumlu. Yorum KVERT raporlarıyla desteklenir; akıntının sınırı değildir.',
  'New bright patch (unexplained)': 'Yeni parlak leke (açıklanamayan)',
  'This area got much brighter between 18 June and 17 August. Radar alone cannot tell us why, so we mark it as unexplained instead of guessing.':
    'Bu alan 18 Haziran ile 17 Ağustos arasında çok parladı. Radar tek başına nedenini söyleyemez, bu yüzden tahmin yürütmek yerine açıklanamayan olarak işaretliyoruz.',
  'Derived by our team from NISAR data, not an official product. Lava interpretation relies on KVERT reports plus backscatter, not a mapped flow outline.':
    'Ekibimiz tarafından NISAR verilerinden türetildi, resmî bir ürün değildir. Lav yorumu, haritalanmış bir akıntı sınırına değil, KVERT raporlarına ve geri saçılıma dayanır.',
  'Data tiers are mixed (PROVISIONAL and VALIDATED), so small calibration differences between dates are possible.':
    'Veri düzeyleri karışık (GEÇİCİ ve DOĞRULANMIŞ); bu yüzden tarihler arasında küçük kalibrasyon farkları olabilir.',

  // ---- Satellite layers (layers.json): titles, plain descriptions and legends
  'Daily true-colour Earth (VIIRS NOAA-20)': 'Günlük gerçek renkli Dünya (VIIRS NOAA-20)',
  'What the whole planet looked like on a given day, in natural colours. Good for spotting volcanic plumes, large floods and smoke.':
    'Tüm gezegenin belirli bir günde doğal renklerle nasıl göründüğü. Volkanik kül bulutlarını, büyük selleri ve dumanı fark etmek için iyidir.',
  'Natural colours, similar to what the human eye would see from space. There is no colour scale: the picture itself is the information.':
    'İnsan gözünün uzaydan göreceğine benzer doğal renkler. Bir renk ölçeği yok: bilginin kendisi resimdir.',
  'No colour key applies. NASA notes an occasional checkered pattern near the poles where several orbits overlap.':
    'Renk anahtarı yok. NASA, birkaç yörüngenin üst üste geldiği kutupların yakınında ara sıra damalı bir desen görülebileceğini belirtiyor.',
  'Radar backscatter, Sentinel-1 (OPERA RTC-S1)': 'Radar geri saçılımı, Sentinel-1 (OPERA RTC-S1)',
  'A radar picture that sees through clouds and works at night. Vegetation looks green, built-up ground white or pink, and smooth surfaces such as calm water black.':
    'Bulutların içini gören ve gece de çalışan bir radar resmi. Bitki örtüsü yeşil, yapılaşmış zemin beyaz ya da pembe, durgun su gibi düz yüzeyler siyah görünür.',
  'Green: vegetated areas': 'Yeşil: bitki örtülü alanlar',
  'White / pink: urban and/or sparsely vegetated areas': 'Beyaz / pembe: kentsel ve/veya seyrek bitki örtülü alanlar',
  'Black: calm water, dry sand, frozen ground': 'Siyah: durgun su, kuru kum, donmuş zemin',
  'Purple / magenta: rough water': 'Mor / eflatun: dalgalı su',
  'A false-colour radar image: vegetation looks green, towns and sparsely vegetated land look white or pink, calm water, dry sand and frozen ground look black, and rough water looks purple or magenta.':
    'Yapay renkli bir radar görüntüsü: bitki örtüsü yeşil, kasabalar ve seyrek bitki örtülü araziler beyaz ya da pembe, durgun su, kuru kum ve donmuş zemin siyah, dalgalı su mor ya da eflatun görünür.',
  'Fire and burn-scar false colour (VIIRS M11-I2-I1)': 'Yangın ve yanık izi yapay renk (VIIRS M11-I2-I1)',
  'A false-colour view where burn scars look deep or bright red and vegetation looks bright green.':
    'Yanık izlerinin koyu ya da parlak kırmızı, bitki örtüsünün parlak yeşil göründüğü yapay renkli bir görünüm.',
  'Deep or bright red: burn scars': 'Koyu ya da parlak kırmızı: yanık izleri',
  'Bright green: vegetation': 'Parlak yeşil: bitki örtüsü',
  'Pinkish: bare soil, desert': 'Pembemsi: çıplak toprak, çöl',
  'Very dark: liquid water on the ground': 'Çok koyu: yerdeki sıvı su',
  'Dark blue: sediment in water': 'Koyu mavi: sudaki tortu',
  'White: low water-droplet clouds': 'Beyaz: alçak su damlacığı bulutları',
  'A false-colour image: burn scars look deep or bright red, vegetation bright green, bare soil pinkish, water very dark, snow and ice turquoise, and low clouds white.':
    'Yapay renkli bir görüntü: yanık izleri koyu ya da parlak kırmızı, bitki örtüsü parlak yeşil, çıplak toprak pembemsi, su çok koyu, kar ve buz turkuaz, alçak bulutlar beyaz görünür.',
  'Fire temperature every 10 minutes (GOES-East ABI)': '10 dakikada bir yangın sıcaklığı (GOES-East ABI)',
  'A weather-satellite view of hot spots over the Americas, refreshed every 10 minutes. Very hot fires glow yellow to white.':
    'Amerika kıtası üzerindeki sıcak noktaların 10 dakikada bir yenilenen hava uydusu görünümü. Çok sıcak yangınlar sarıdan beyaza parlar.',
  'Red: warm fire': 'Kırmızı: ılık yangın',
  'Orange: very warm fire': 'Turuncu: çok ılık yangın',
  'Yellow: hot fire': 'Sarı: sıcak yangın',
  'Near white: very hot fire': 'Beyaza yakın: çok sıcak yangın',
  'Shades of maroon: burn scars': 'Bordo tonları: yanık izleri',
  'Purples to pink: clear sky over land': 'Mordan pembeye: kara üzerinde açık gökyüzü',
  'Near black: clear sky over water, snow, or night': 'Siyaha yakın: su üzerinde açık gökyüzü, kar veya gece',
  'Shades of blue: water clouds': 'Mavi tonları: su bulutları',
  'Shades of green: ice clouds': 'Yeşil tonları: buz bulutları',
  'Fires go from red (warm) through orange and yellow to near white (very hot). Burn scars are maroon, clear land is purple to pink, water clouds are blue and ice clouds are green.':
    'Yangınlar kırmızıdan (ılık) turuncu ve sarıya, oradan beyaza yakın renge (çok sıcak) gider. Yanık izleri bordo, açık kara mordan pembeye, su bulutları mavi, buz bulutları yeşildir.',
  'Vegetation disturbance alerts (OPERA DIST-ALERT, HLS)': 'Bitki örtüsü bozulma uyarıları (OPERA DIST-ALERT, HLS)',
  'Flags places where plants have recently been lost, for example after a fire, logging or clearing. Red means a confirmed loss of at least half of the vegetation cover.':
    'Yakın zamanda bitki kaybedilen yerleri işaretler; örneğin bir yangından, ağaç kesiminden ya da arazi açmadan sonra. Kırmızı, bitki örtüsünün en az yarısının doğrulanmış kaybı demektir.',
  'No disturbance': 'Bozulma yok',
  'Tree cover loss year 2001-2025 (Hansen / UMD GFC v1.13)': 'Ağaç örtüsü kaybı yılı 2001-2025 (Hansen / UMD GFC v1.13)',
  'Where trees were lost between 2001 and 2025. The colour shows the year the loss was detected.':
    '2001 ile 2025 arasında ağaçların kaybedildiği yerler. Renk, kaybın tespit edildiği yılı gösterir.',
  'Yellow appears to mark the oldest tree cover loss and red the most recent, with black for no loss. UMD publishes no legend for this version of the tiles, so the year labels are our own reading of the tiles, not an official key.':
    'Sarı en eski ağaç örtüsü kaybını, kırmızı en yenisini, siyah ise kayıp olmamasını gösteriyor gibi. UMD bu karo sürümü için bir renk açıklaması yayımlamıyor; bu yüzden yıl etiketleri resmî bir anahtar değil, karoları bizim okumamızdır.',
  'Daily snow cover (MODIS Terra NDSI)': 'Günlük kar örtüsü (MODIS Terra NDSI)',
  'Where the ground is covered by snow on a given day.': 'Belirli bir günde zeminin karla kaplı olduğu yerler.',
  'NDSI snow cover (0-100)': 'NDSI kar örtüsü (0-100)',
  'Pale yellow means a weak snow signal, salmon pink a strong one and bright red the maximum. Where nothing is drawn there is no snow, or the ground could not be seen (cloud, night, water).':
    'Soluk sarı zayıf bir kar sinyali, somon pembesi güçlü bir sinyal, parlak kırmızı en yüksek değer demektir. Hiçbir şey çizilmeyen yerde kar yoktur ya da zemin görülemedi (bulut, gece, su).',
  'Sea ice concentration (GHRSST MUR L4)': 'Deniz buzu yoğunluğu (GHRSST MUR L4)',
  'How much of the polar ocean is covered by floating sea ice each day.': 'Kutup okyanusunun her gün ne kadarının yüzen deniz buzuyla kaplı olduğu.',
  'The colour shows how much of the sea surface is covered by ice: purple for a little, violet-blue for about a quarter, green for about half, yellow for three quarters, red for about 90 % and white for a fully ice-covered sea. Ice-free ocean is drawn almost black.':
    'Renk, deniz yüzeyinin ne kadarının buzla kaplı olduğunu gösterir: az için mor, yaklaşık dörtte bir için menekşe-mavi, yaklaşık yarı için yeşil, dörtte üç için sarı, yaklaşık %90 için kırmızı ve tamamen buzla kaplı deniz için beyaz. Buzsuz okyanus neredeyse siyah çizilir.',
  'Daytime land surface temperature (MODIS Terra)': 'Gündüz kara yüzeyi sıcaklığı (MODIS Terra)',
  'How hot the ground surface was in the late morning, measured from its heat glow.': 'Zemin yüzeyinin geç sabah saatlerinde ne kadar sıcak olduğu, ısı ışımasından ölçüldü.',
  'Surface skin temperature, not air temperature. No data under cloud. 1 km pixels mix land-cover types. SAR is not a substitute: thermal IR is the correct observation.':
    'Hava sıcaklığı değil, yüzey sıcaklığı. Bulut altında veri yok. 1 km’lik pikseller arazi örtüsü türlerini karıştırır. SAR bunun yerini tutmaz: doğru gözlem termal kızılötesidir.',
  'Purple and blue are the coldest ground, green is around freezing (273 K is 0 degrees Celsius), yellow is warm (300 K is about 27 degrees Celsius) and orange to red is very hot ground.':
    'Mor ve mavi en soğuk zemin, yeşil donma noktası civarı (273 K, 0 santigrat derecedir), sarı ılık (300 K yaklaşık 27 santigrat derecedir), turuncudan kırmızıya ise çok sıcak zemindir.',
  'Root-zone soil moisture (SMAP L4)': 'Kök bölgesi toprak nemi (SMAP L4)',
  'How wet the soil is down to about 1 metre: a model guided by satellite measurements. Useful for drought.':
    'Toprağın yaklaşık 1 metre derinliğe kadar ne kadar ıslak olduğu: uydu ölçümleriyle yönlendirilen bir model. Kuraklık için yararlıdır.',
  'Orange and yellow mean dry soil, green means moderately moist, and light blue to dark blue means wet soil. The very wettest soils are shown dark grey.':
    'Turuncu ve sarı kuru toprak, yeşil orta derecede nemli, açık maviden koyu maviye ıslak toprak demektir. En ıslak topraklar koyu gri gösterilir.',
  'Flood water, 2-day composite (MODIS Terra + Aqua)': 'Sel suyu, 2 günlük bileşim (MODIS Terra + Aqua)',
  'Shows flood water (water where it is not normally present) as well as normal surface water, combining two days of observations to see past some clouds.':
    'Sel suyunu (normalde bulunmadığı yerlerdeki suyu) ve normal yüzey suyunu gösterir; bazı bulutların ötesini görmek için iki günlük gözlemi birleştirir.',
  'Surface water (normal water)': 'Yüzey suyu (normal su)',
  'Recurring flood': 'Tekrarlayan sel',
  'Insufficient data': 'Yetersiz veri',
  'Red is flood water, yellow is flooding that returns to the same place in many years, and cyan is water that is normally there. Grey means there was not enough data.':
    'Kırmızı sel suyu, sarı birçok yılda aynı yere dönen sel, camgöbeği ise normalde orada bulunan sudur. Gri, yeterli veri olmadığı anlamına gelir.',
  'Surface water from radar (OPERA DSWx-S1)': 'Radardan yüzey suyu (OPERA DSWx-S1)',
  'Open water mapped by radar, so it works through clouds: useful during floods.': 'Radarla haritalanmış açık su; bu yüzden bulutlara rağmen çalışır: sellerde yararlıdır.',
  'Not water': 'Su değil',
  'Open water': 'Açık su',
  'Inundated vegetation': 'Su basmış bitki örtüsü',
  'Masked: Height Above Nearest Drainage (HAND)': 'Maskelendi: En Yakın Drenaja Göre Yükseklik (HAND)',
  'Masked: radar layover / shadow': 'Maskelendi: radar üst üste binme / gölge',
  'Surface water occurrence 1984-2024 (JRC Global Surface Water v1.5)': 'Yüzey suyu görülme sıklığı 1984-2024 (JRC Küresel Yüzey Suyu v1.5)',
  'Solid blue means water was there almost all the time. Purple means about half the time, and faint red or pink means water was seen only rarely. Places never seen as water are left empty.':
    'Koyu mavi, suyun neredeyse her zaman orada olduğu anlamına gelir. Mor yaklaşık yarı zaman, soluk kırmızı ya da pembe ise suyun yalnızca nadiren görüldüğü anlamına gelir. Hiç su olarak görülmeyen yerler boş bırakılır.',
  'Water gained and lost 1984-2024 (JRC GSW transitions)': 'Kazanılan ve kaybedilen su 1984-2024 (JRC GSW geçişleri)',
  'Shows where new lakes or reservoirs appeared, where water disappeared, and where it became seasonal, between the first and last years of the record.':
    'Kaydın ilk ve son yılları arasında yeni göllerin ya da baraj göllerinin nerede ortaya çıktığını, suyun nerede kaybolduğunu ve nerede mevsimsel hâle geldiğini gösterir.',
  'Permanent': 'Kalıcı',
  'New permanent': 'Yeni kalıcı',
  'Lost permanent': 'Kaybolan kalıcı',
  'Seasonal': 'Mevsimsel',
  'New seasonal': 'Yeni mevsimsel',
  'Lost seasonal': 'Kaybolan mevsimsel',
  'Seasonal to permanent': 'Mevsimselden kalıcıya',
  'Permanent to seasonal': 'Kalıcıdan mevsimsele',
  'Ephemeral permanent': 'Geçici kalıcı',
  'Ephemeral seasonal': 'Geçici mevsimsel',
  'Blue is water that stayed permanent. Green shades are new water, dark red and pink are water that was lost, and orange and yellow mark water that switched between seasonal and permanent. Grey is water that appeared and then disappeared again.':
    'Mavi kalıcı kalan sudur. Yeşil tonları yeni su, koyu kırmızı ve pembe kaybolan su, turuncu ve sarı ise mevsimsel ile kalıcı arasında değişen suyu gösterir. Gri, ortaya çıkıp yeniden kaybolan sudur.',
  'Annual vegetation disturbance (OPERA DIST-ANN, HLS)': 'Yıllık bitki örtüsü bozulması (OPERA DIST-ANN, HLS)',
  'A yearly summary of where vegetation was lost or damaged.': 'Bitki örtüsünün nerede kaybedildiğinin ya da zarar gördüğünün yıllık özeti.',
  'Vegetation greenness, 16-day (MODIS Terra NDVI)': 'Bitki örtüsü yeşilliği, 16 günlük (MODIS Terra NDVI)',
  'How green and leafy the land is, averaged over 16 days. It shows crops, droughts and seasons.': 'Arazinin 16 gün ortalamasında ne kadar yeşil ve yapraklı olduğu. Ekinleri, kuraklıkları ve mevsimleri gösterir.',
  'Pale and brown tones mean little or no green vegetation, yellow-green means some, and dark green means dense, leafy vegetation.':
    'Soluk ve kahverengi tonlar az ya da hiç yeşil bitki örtüsü olmadığı, sarı-yeşil biraz olduğu, koyu yeşil ise yoğun, yapraklı bitki örtüsü olduğu anlamına gelir.',
  'agricultural expansion and irrigation': 'tarımsal genişleme ve sulama',
  'Built-up and settlement extent 2010 (HBASE, Landsat)': 'Yapılaşma ve yerleşim alanı 2010 (HBASE, Landsat)',
  'Where buildings and settlements were around 2010: a baseline to compare against today\'s imagery.': '2010 civarında binaların ve yerleşimlerin bulunduğu yerler: bugünkü görüntülerle karşılaştırmak için bir başlangıç noktası.',
  'HBASE (built-up and settlement)': 'HBASE (yapılaşma ve yerleşim)',
  'Road': 'Yol',
  'Not HBASE': 'HBASE değil',
  'Orange is built-up or settled land around 2010 and blue is roads. Light grey is land that is not built-up.':
    'Turuncu, 2010 civarında yapılaşmış ya da yerleşilmiş arazi, mavi yollardır. Açık gri yapılaşmamış arazidir.',
  'Night lights, daily (VIIRS Day/Night Band, NOAA-20)': 'Gece ışıkları, günlük (VIIRS Gündüz/Gece Bandı, NOAA-20)',
  'war/conflict and disaster outage context': 'savaş/çatışma ve afet kaynaklı elektrik kesintisi bağlamı',
  'Lights at night seen from space: cities, roads, gas flares and fishing fleets. Outages after disasters show up as missing lights.':
    'Uzaydan görülen gece ışıkları: şehirler, yollar, gaz yakma bacaları ve balıkçı filoları. Afetlerden sonraki kesintiler eksik ışıklar olarak görünür.',
  'A greyscale picture: the brighter the pixel, the more light reached the satellite at night. Black is dark, white is the brightest light.':
    'Gri tonlu bir resim: piksel ne kadar parlaksa gece uyduya o kadar çok ışık ulaşmıştır. Siyah karanlık, beyaz en parlak ışıktır.',
  'Cloud-free Sentinel-2 yearly mosaics 2017-2025 (EOX)': 'Bulutsuz Sentinel-2 yıllık mozaikleri 2017-2025 (EOX)',
  'land reclamation and coastal construction': 'denizden arazi kazanımı ve kıyı inşaatı',
  'One cloud-free picture of Earth per year. Flip between years to watch cities, mines and new coastlines grow.':
    'Her yıl Dünya’nın bulutsuz bir resmi. Şehirlerin, madenlerin ve yeni kıyı şeritlerinin büyümesini izlemek için yıllar arasında geçiş yapın.',
  'A colour picture of the land made from a year of Sentinel-2 images with the clouds removed. There is no colour scale: the picture itself is the information.':
    'Bulutları temizlenmiş bir yıllık Sentinel-2 görüntüsünden yapılmış renkli bir arazi resmi. Bir renk ölçeği yok: bilginin kendisi resimdir.',
  'No colour key applies. EOX states the mosaics favour visual clarity and consistency over spectral accuracy.':
    'Renk anahtarı yok. EOX, mozaiklerin spektral doğruluk yerine görsel netliği ve tutarlılığı öne çıkardığını belirtiyor.',
};

/** Rules for text that carries numbers or names. First match wins. */
export const TR_PATTERNS: [RegExp, string | ((...m: string[]) => string)][] = [
  [/^Wildfire in (.+?) (\d+)$/, 'Orman yangını, $1 $2'],
  [/^Wildfire in (.+)$/, 'Orman yangını, $1'],
  [/^Prescribed Fire (.+)$/, 'Kontrollü yakma $1'],
  [/^(\d+) NISAR layers?$/, '$1 NISAR katmanı'],
  [/^(\d+) NISAR scenes?$/, '$1 NISAR sahnesi'],
  [/^(.+) · (\d+) NISAR layers?$/, (_a, k, n) => `${TR[k] ?? k} · ${n} NISAR katmanı`],
  [/^(.+) · (.+) · (\d+) NISAR scenes?$/, (_a, k, t, n) => `${TR[k] ?? k} · ${TR[t] ?? t} · ${n} NISAR sahnesi`],
  [/^Satellite layers \((\d+)\)$/, 'Uydu katmanları ($1)'],
  [/^After opacity (\d+)%$/, 'Sonraki görüntünün saydamlığı %$1'],
  [/^(\d+) observations? of (.+)$/, (_a, n, x) => `${TR[x] ?? x}: ${n} gözlem`],
  [/^About (.+)$/, (_a, x) => `${TR[x] ?? x} hakkında`],
  [/^Colour legend: (.+)$/, (_a, x) => `Renk açıklaması: ${TR[x] ?? x}`],
  [/^Annotation (\d+): (.+)$/, (_a, n, x) => `Not ${n}: ${TR[x] ?? x}`],
  [/^Show (.+) types$/, (_a, x) => `${TR[x] ?? x} türlerini göster`],
  [/^(.+) investigation$/, (_a, x) => `${TR[x] ?? x} araştırması`],
  [/^(.+) (date|opacity)$/, (_a, x, k) => (TR[x] ? `${TR[x]} ${k === 'date' ? 'tarihi' : 'saydamlığı'}` : `${x} ${k}`)],
  [/^GCOV validity mask applied: samples flagged 0 \(not from fully-focused radar samples\) or 255 \(outside the swath\) set to no-data \(([\d.]+) % of pixels\)\.$/,
    'GCOV geçerlilik maskesi uygulandı: 0 (tam odaklanmış radar örneklerinden değil) ya da 255 (tarama şeridinin dışında) işaretli örnekler veri yok olarak ayarlandı (piksellerin %$1’i).'],
  [/^(city|town|village|province|state|country|university|square|sports_centre|park|county|district|region|island|mountain|volcano|lake|river) · (.+)$/,
    (_a, k, p) => `${({ city: 'şehir', town: 'kasaba', village: 'köy', province: 'il', state: 'eyalet', country: 'ülke', university: 'üniversite', square: 'meydan', sports_centre: 'spor merkezi', park: 'park', county: 'ilçe', district: 'bölge', region: 'bölge', island: 'ada', mountain: 'dağ', volcano: 'yanardağ', lake: 'göl', river: 'nehir' } as Record<string, string>)[k]} · ${p.replace(/\bTurkey\b/g, 'Türkiye')}`],
  [/^(.*)\bTurkey\b(.*)$/, (_a, x, y) => `${x}Türkiye${y}`],
  [/^(\d+) results?$/, '$1 sonuç'],
  [/^(\d+) products?$/, '$1 ürün'],
  [/^(\d+) collections?$/, '$1 koleksiyon'],
  [/^(\d+) granules?$/, '$1 granül'],
];
