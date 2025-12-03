// =================================================================================
// SIBOLGA 2015-2025: FIX MERGE TYPES + RGB TIAP TAHUN
// =================================================================================

// 1. AREA OF INTEREST
var aoi = ee.Geometry.Rectangle([98.74, 1.70, 98.85, 1.80]);
Map.centerObject(aoi, 13); // Zoom diperdekat sedikit

// 2. RENTANG TAHUN
var years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

// 3. VISUALISASI
var ndviVis = {min: 0, max: 0.8, palette: ['white', 'yellow', 'green', 'darkgreen']};
var rgbVis = {min: 0.0, max: 0.3, bands: ['Red', 'Green', 'Blue']};
var changeVis = {min: -0.4, max: 0.4, palette: ['red', 'orange', 'white', 'lightgreen', 'darkgreen']}; 

// --- FUNGSI PENGOLAH DATA (DENGAN FIX CASTING) ---

function processLandsat(image) {
  var qa = image.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 4).eq(0));
  
  return image.updateMask(mask)
    .select(['SR_B4', 'SR_B5', 'SR_B3', 'SR_B2'], ['Red', 'NIR', 'Green', 'Blue'])
    .multiply(0.0000275).add(-0.2)
    .toFloat() // <--- WAJIB: Paksa jadi Float standar agar cocok dgn Sentinel
    .set('system:time_start', image.get('system:time_start'));
}

function processSentinel(image) {
  var scl = image.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  
  return image.updateMask(mask)
    .select(['B4', 'B8', 'B3', 'B2'], ['Red', 'NIR', 'Green', 'Blue'])
    .divide(10000)
    .toFloat() // <--- WAJIB: Paksa jadi Float standar
    .set('system:time_start', image.get('system:time_start'));
}

function addNDVI(image) {
  return image.addBands(image.normalizedDifference(['NIR', 'Red']).rename('NDVI'));
}

// FUNGSI GET IMAGE (Landsat + Sentinel Merge)
function getYearImage(year) {
  var start = year + '-01-01';
  var end = year + '-12-31';

  var L8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2') 
             .filterBounds(aoi).filterDate(start, end)
             .map(processLandsat).map(addNDVI);
             
  var S2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
             .filterBounds(aoi).filterDate(start, end)
             .map(processSentinel).map(addNDVI);

  // Merge sekarang aman karena sudah sama-sama .toFloat()
  var merged = L8.merge(S2);
  
  return merged.median().clip(aoi);
}

// --- LOOPING VISUALISASI ---

print('Menyiapkan Layer RGB & Analisis 2015-2025...');

for (var i = 0; i < years.length; i++) {
  var currentYear = years[i];
  
  // 1. Proses Gambar
  var imgCurrent = getYearImage(currentYear);
  
  // 2. Tampilkan RGB (True Color) Tiap Tahun
  // Saya set 'false' (hidden) agar loading awal tidak berat. 
  // Centang manual di Layer Panel untuk melihat tahun yg diinginkan.
  Map.addLayer(imgCurrent, rgbVis, 'RGB ' + currentYear, false);
  
  // 3. Tampilkan NDVI (Opsional/Hidden)
  Map.addLayer(imgCurrent.select('NDVI'), ndviVis, 'NDVI ' + currentYear, false);

  // 4. Analisis Perubahan (Bahaya)
  if (i > 0) {
    var prevYear = years[i-1];
    var imgPrev = getYearImage(prevYear);
    
    var diff = imgCurrent.select('NDVI').subtract(imgPrev.select('NDVI'));
    
    // Threshold Bahaya: Turun lebih dari 0.15
    var danger = diff.lt(-0.15); 
    var dangerMasked = danger.updateMask(danger); 
    
    // Layer Bahaya (Merah) - Default Nyala (True)
    Map.addLayer(dangerMasked, {palette: ['FF0000']}, '⚠️ BAHAYA (' + currentYear + ' vs ' + prevYear + ')', true);
  }
}

// Batas Area
var outline = ee.Image().byte().paint({featureCollection: aoi, color: 1, width: 3});
Map.addLayer(outline, {palette: 'red'}, 'AOI Boundary');

print('Selesai. Cek tab "Layers" di kanan atas peta.');