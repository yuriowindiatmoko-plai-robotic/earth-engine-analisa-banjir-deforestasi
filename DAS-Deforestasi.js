// =================================================================================
// PADANG & PADANG PANJANG: FIX ERROR "bands.contains is not a function"
// =================================================================================

// 1. AREA OF INTEREST
var aoi = ee.Geometry.Polygon([
  [[100.1597441023232, -0.8763470039066672],
   [100.47697432693258, -0.8763470039066672],
   [100.47697432693258, -0.3792470578810841],
   [100.1597441023232, -0.3792470578810841],
   [100.1597441023232, -0.8763470039066672]]
]);

Map.centerObject(aoi, 11);

// 2. CONFIG TAHUN
var analysisYears = [2010, 2015, 2020, 2025]; // Utama
var extraYears = [2017, 2019, 2021, 2023];    // Tambahan Visual
var allYears = analysisYears.concat(extraYears).sort();

// 3. WATER MASK
var waterMask = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('max_extent').eq(0);

// VISUALIZATION PARAMS
var visRGB_S2 = {min: 0.0, max: 0.3, bands: ['Red', 'Green', 'Blue']}; 
var visRGB_L8 = {min: 0.0, max: 0.3, bands: ['Red', 'Green', 'Blue']};
var visRGB_L5 = {min: 0.0, max: 0.3, bands: ['Red', 'Green', 'Blue']};
var visNDVI = {min: 0, max: 0.8, palette: ['white', '#ceea84', '#70a800', '#004d00']};

// --- FUNGSI PROSES CITRA (FIXED) ---

// Fungsi NDVI yang Sederhana & Stabil
function addNDVI(image) {
  // Langsung hitung saja karena band 'Red' & 'NIR' sudah disiapkan oleh fungsi prep
  var ndvi = image.normalizedDifference(['NIR', 'Red']).rename('NDVI');
  return image.addBands(ndvi);
}

// LANDSAT 5 (2010)
function prepLandsat5(image) {
  var qa = image.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 4).eq(0));
  return image.updateMask(mask).updateMask(waterMask)
    // Rename band L5: B3->Red, B4->NIR
    .select(['SR_B3', 'SR_B2', 'SR_B1', 'SR_B4'], ['Red', 'Green', 'Blue', 'NIR'])
    .multiply(0.0000275).add(-0.2).toFloat();
}

// LANDSAT 8/9 (2015 & Analisis)
function prepLandsat89(image) {
  var qa = image.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 4).eq(0));
  return image.updateMask(mask).updateMask(waterMask)
    // Rename band L8: B4->Red, B5->NIR
    .select(['SR_B4', 'SR_B3', 'SR_B2', 'SR_B5'], ['Red', 'Green', 'Blue', 'NIR'])
    .multiply(0.0000275).add(-0.2).toFloat();
}

// SENTINEL-2 (Visual Tajam 2017++)
function prepSentinel2(image) {
  var scl = image.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)); 
  return image.updateMask(mask).updateMask(waterMask)
    // Rename band S2: B4->Red, B8->NIR
    .select(['B4', 'B3', 'B2', 'B8'], ['Red', 'Green', 'Blue', 'NIR'])
    .divide(10000).toFloat();
}

// --- INTELLIGENT IMAGE GETTER ---

function getImage(year, purpose) {
  var start = year + '-01-01';
  var end = year + '-12-31';
  
  // 1. MODE ANALISIS (HARUS KONSISTEN LANDSAT)
  if (purpose == 'analysis') {
    if (year < 2013) {
      return ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
        .filterBounds(aoi).filterDate(start, end)
        .map(prepLandsat5).map(addNDVI).median().clip(aoi);
    } else {
      return ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
        .filterBounds(aoi).filterDate(start, end)
        .map(prepLandsat89).map(addNDVI).median().clip(aoi);
    }
  }
  
  // 2. MODE VISUAL (PILIH YANG PALING TAJAM)
  if (purpose == 'visual') {
    // 2010: Landsat 5
    if (year == 2010) {
      var img = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
        .filterBounds(aoi).filterDate(start, end)
        .map(prepLandsat5).map(addNDVI).median().clip(aoi);
      return {image: img, type: 'L5', vis: visRGB_L5};
    }
    // 2015: Landsat 8 (Sentinel sering kosong di tahun ini)
    else if (year == 2015) {
      var img = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
        .filterBounds(aoi).filterDate(start, end)
        .map(prepLandsat89).map(addNDVI).median().clip(aoi);
      return {image: img, type: 'L8', vis: visRGB_L8};
    }
    // 2016++: Sentinel-2
    else {
      var img = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(aoi).filterDate(start, end)
        .map(prepSentinel2).map(addNDVI).median().clip(aoi);
      return {image: img, type: 'S2', vis: visRGB_S2};
    }
  }
}

// --- LOOP VISUALISASI ---
print('=== MENYIAPKAN LAYER RGB & NDVI ===');

allYears.forEach(function(year) {
  var data = getImage(year, 'visual');
  var img = ee.Image(data.image); 
  
  var satelliteName = (data.type == 'S2') ? 'Sentinel' : 'Landsat';
  var layerNameRGB = 'RGB ' + year + ' (' + satelliteName + ')';
  
  // Layer RGB
  Map.addLayer(img, data.vis, layerNameRGB, false);
  // Layer NDVI
  Map.addLayer(img.select('NDVI'), visNDVI, 'NDVI ' + year, false);
});


// --- LOOP ANALISIS DEFORESTASI ---
print('=== ANALISIS DEFORESTASI (Consoles) ===');

for (var i = 0; i < analysisYears.length - 1; i++) {
  var y1 = analysisYears[i];
  var y2 = analysisYears[i+1];
  
  var img1 = getImage(y1, 'analysis');
  var img2 = getImage(y2, 'analysis');
  
  var diff = img2.select('NDVI').subtract(img1.select('NDVI'));
  var deforest = diff.lt(-0.20).selfMask(); 
  
  Map.addLayer(deforest, {palette: ['red']}, '⚠️ Deforestasi ' + y1 + '-' + y2, true);
  
  // Hitung Luas
  var areaImage = deforest.multiply(ee.Image.pixelArea());
  var stats = areaImage.reduceRegion({
    reducer: ee.Reducer.sum(), geometry: aoi, scale: 30, maxPixels: 1e10
  });
  
  (function(yearRange) {
     ee.Number(stats.get('NDVI')).divide(10000).evaluate(function(val) {
       print('Luas Deforestasi ' + yearRange + ':', val ? val.toFixed(2) + ' Ha' : '0 Ha');
     });
  })(y1 + '-' + y2);
}

var outline = ee.Image().byte().paint({featureCollection: aoi, color: 1, width: 2});
Map.addLayer(outline, {palette: 'yellow'}, 'Batas Area (AOI)');

// =================================================================================
// PETA DAS SUMATERA + HIGHLIGHT KHUSUS DAS ANAI
// =================================================================================

// --- 1. Import Data ---
var das_boundaries = ee.FeatureCollection('projects/banjir-sumatera-479906/assets/Batas_DAS_KLHK');

// --- 2. Filter Berdasarkan Kode Provinsi ---
// Aceh=11, Sumut=12, Sumbar=13
var sumatera_focus = das_boundaries.filter(ee.Filter.inList('kode_prov', [11, 12, 13]));

// --- 3. Visualisasi Peta Dasar (Color Coded per Provinsi) ---
var image_painted = ee.Image().paint({
  featureCollection: sumatera_focus,
  color: 'kode_prov', 
  width: 1 // Saya tipiskan sedikit agar highlight nanti lebih jelas
});

var vis_params = {
  palette: ['FF0000', '00FF00', '0000FF'], // Merah (11), Hijau (12), Biru (13)
  min: 11, 
  max: 13  
};

Map.addLayer(image_painted, vis_params, 'Wilayah DAS (Aceh, Sumut, Sumbar)');


// --- [BARU] 3b. VISUALISASI KHUSUS DAS ANAI ---
// Filter khusus untuk mengambil hanya DAS ANAI di Sumatera Barat (13)
var das_anai = sumatera_focus.filter(
  ee.Filter.and(
    ee.Filter.eq('kode_prov', 13), // Pastikan Sumbar
    ee.Filter.eq('nama_das', 'ANAI') // Pastikan namanya ANAI
  )
);

// Style Khusus untuk Anai (Warna Cyan + Isi Transparan)
var style_anai = {
  color: 'cyan',       // Garis pinggir warna Cyan terang
  width: 3,            // Garis lebih tebal
  fillColor: '00FFFF44' // Isi warna Cyan tapi transparan (44 adalah alpha/opacity)
};

// Tambahkan ke Peta
Map.addLayer(das_anai.style(style_anai), {}, '📍 FOKUS: DAS ANAI');

// Zoom otomatis ke DAS Anai
Map.centerObject(das_anai, 11);


// --- 4. MEMBUAT DASHBOARD INFO (UI PANEL) ---
var panel = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '8px 15px',
    width: '300px'
  }
});

var title = ui.Label({
  value: 'Informasi DAS Terpilih',
  style: {fontWeight: 'bold', fontSize: '16px', margin: '0 0 4px 0'}
});

var inspector = ui.Label({
  value: 'Klik pada area peta untuk melihat Nama DAS...',
  style: {color: 'gray'}
});

panel.add(title);
panel.add(inspector);
Map.add(panel);

// --- 5. INTERAKSI KLIK ---
Map.onClick(function(coords) {
  inspector.setValue('Sedang memuat...');
  var point = ee.Geometry.Point(coords.lon, coords.lat);
  
  // Cari DAS yang diklik
  var selected_das = sumatera_focus.filterBounds(point).first();
  
  selected_das.evaluate(function(feature) {
    if (feature) {
      var nama = feature.properties.nama_das;
      var kode = feature.properties.kode_prov;
      var provName = '';
      
      if (kode == 11) provName = 'Aceh';
      else if (kode == 12) provName = 'Sumatera Utara';
      else if (kode == 13) provName = 'Sumatera Barat';
      
      inspector.setValue('DAS: ' + nama + '\nProvinsi: ' + provName + ' (' + kode + ')');
      
      // Highlight Kuning saat diklik (User Feedback)
      var highlight = ee.Feature(feature);
      var highlightLayer = ui.Map.Layer(highlight.style({color: 'yellow', width: 4, fillColor: '00000000'}), {}, 'Highlight Klik');
      
      var layers = Map.layers();
      // Pastikan urutan layer highlight klik ada di paling atas
      // Layer 0: Peta Dasar, Layer 1: DAS Anai, Layer 2: Highlight Klik
      var layerIndex = 2; 
      
      if (layers.length() > layerIndex) {
        layers.set(layerIndex, highlightLayer);
      } else {
        layers.add(highlightLayer);
      }
      
    } else {
      inspector.setValue('Tidak ada DAS di lokasi ini.');
    }
  });
});

Map.style().set('cursor', 'crosshair');