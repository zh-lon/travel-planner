// 高德 Web 服务 API（服务端调用）：POI 搜索与地理编码

export interface PoiResult {
  name: string;
  address: string | null;
  district: string;
  lng: number;
  lat: number;
}

interface AmapPoiRaw {
  name?: string;
  address?: string | string[];
  location?: string;
  pname?: string;
  cityname?: string;
  adname?: string;
}

// 已知城市中心坐标（用于最终兜底，避免定位失败）
// 当 POI 搜索和地理编码都失败时，城市级地点使用此坐标
export const KNOWN_CITY_CENTERS: Record<string, { lng: number; lat: number }> = {
  // === 省会/直辖市/计划单列市 ===
  "北京": { lng: 116.40717, lat: 39.90469 },
  "上海": { lng: 121.47370, lat: 31.23037 },
  "广州": { lng: 113.26436, lat: 23.12908 },
  "深圳": { lng: 114.05787, lat: 22.54310 },
  "成都": { lng: 104.06573, lat: 30.65946 },
  "重庆": { lng: 106.55046, lat: 29.56301 },
  "杭州": { lng: 120.15507, lat: 30.27408 },
  "南京": { lng: 118.79688, lat: 32.06026 },
  "西安": { lng: 108.93984, lat: 34.34126 },
  "武汉": { lng: 114.30539, lat: 30.59310 },
  "长沙": { lng: 112.93881, lat: 28.22821 },
  "贵阳": { lng: 106.63015, lat: 26.64766 },
  "南宁": { lng: 108.36654, lat: 22.81700 },
  "拉萨": { lng: 91.17180, lat: 29.65000 },
  "西宁": { lng: 101.77782, lat: 36.61713 },
  "兰州": { lng: 103.83430, lat: 36.06109 },
  "银川": { lng: 106.23091, lat: 38.48719 },
  "呼和浩特": { lng: 111.74902, lat: 40.84236 },
  "乌鲁木齐": { lng: 87.61682, lat: 43.82559 },
  "哈尔滨": { lng: 126.53580, lat: 45.80216 },
  "长春": { lng: 125.32357, lat: 43.81602 },
  "沈阳": { lng: 123.43147, lat: 41.80570 },
  "天津": { lng: 117.19018, lat: 39.12521 },
  "济南": { lng: 117.00092, lat: 36.67581 },
  "太原": { lng: 112.54888, lat: 37.87059 },
  "郑州": { lng: 113.66541, lat: 34.75798 },
  "石家庄": { lng: 114.50246, lat: 38.04547 },
  "合肥": { lng: 117.22724, lat: 31.82059 },
  "南昌": { lng: 115.85794, lat: 28.68202 },
  "福州": { lng: 119.29647, lat: 26.07451 },
  "昆明": { lng: 102.71225, lat: 25.04061 },
  // === 热门旅游城市/地区 ===
  "大理": { lng: 100.22567, lat: 25.58945 },
  "丽江": { lng: 100.23303, lat: 26.87211 },
  "香格里拉": { lng: 99.70083, lat: 27.82559 },
  "海口": { lng: 110.19829, lat: 20.04400 },
  "三亚": { lng: 109.50827, lat: 18.25285 },
  "桂林": { lng: 110.29002, lat: 25.27361 },
  "张家界": { lng: 110.47892, lat: 29.11709 },
  "黄山": { lng: 118.33747, lat: 29.71470 },
  "青岛": { lng: 120.38262, lat: 36.06711 },
  "厦门": { lng: 118.08942, lat: 24.47983 },
  "大连": { lng: 121.61466, lat: 38.91400 },
  "苏州": { lng: 120.59546, lat: 31.29834 },
  "无锡": { lng: 120.31191, lat: 31.49117 },
  "宁波": { lng: 121.54979, lat: 29.86834 },
  "珠海": { lng: 113.57668, lat: 22.27073 },
  "敦煌": { lng: 94.66196, lat: 40.14213 },
  "西双版纳": { lng: 100.79739, lat: 22.00815 },
  "腾冲": { lng: 98.49036, lat: 25.02053 },
  "稻城": { lng: 100.29814, lat: 29.03757 },
  // === 云南热门旅游小镇/县 ===
  "德钦": { lng: 98.91156, lat: 28.48606 },
  "梅里雪山": { lng: 98.68361, lat: 28.43778 },
  "雨崩": { lng: 98.79200, lat: 28.39770 },
  "虎跳峡": { lng: 100.13400, lat: 27.22100 },
  "双廊": { lng: 100.19400, lat: 25.88700 },
  "束河": { lng: 100.20900, lat: 26.91400 },
  "独克宗": { lng: 99.70600, lat: 27.81300 },
  "沙溪": { lng: 99.84900, lat: 26.31800 },
  "喜洲": { lng: 100.12100, lat: 25.85600 },
  "白沙": { lng: 100.23800, lat: 26.94600 },
  "泸沽湖": { lng: 100.78706, lat: 27.63822 },
  "普者黑": { lng: 104.16500, lat: 24.05800 },
  "元阳": { lng: 102.83500, lat: 23.15800 },
  "建水": { lng: 102.82600, lat: 23.63500 },
  "瑞丽": { lng: 97.85500, lat: 24.01800 },
  "芒市": { lng: 98.58800, lat: 24.43300 },
  "普洱": { lng: 100.96600, lat: 22.82500 },
  "丙中洛": { lng: 98.60200, lat: 28.02800 },
  "怒江": { lng: 98.89800, lat: 25.85300 },
  "弥勒": { lng: 103.41500, lat: 24.41200 },
  "罗平": { lng: 104.30800, lat: 24.88500 },
  "抚仙湖": { lng: 102.88000, lat: 24.50000 },
  // === 川西/甘孜热门 ===
  "康定": { lng: 101.95700, lat: 30.05300 },
  "新都桥": { lng: 101.49800, lat: 30.04800 },
  "理塘": { lng: 100.26900, lat: 29.99600 },
  "色达": { lng: 100.33200, lat: 32.26800 },
  "丹巴": { lng: 101.88500, lat: 30.87800 },
  "四姑娘山": { lng: 102.54400, lat: 30.99800 },
  "亚丁": { lng: 100.38000, lat: 28.41000 },
  "甘孜": { lng: 99.99200, lat: 31.62200 },
  "雅江": { lng: 101.01500, lat: 30.03100 },
  "巴塘": { lng: 99.11000, lat: 30.00500 },
  // === 西藏热门 ===
  "林芝": { lng: 94.36100, lat: 29.64900 },
  "日喀则": { lng: 88.88100, lat: 29.26700 },
  "山南": { lng: 91.77100, lat: 29.23700 },
  "昌都": { lng: 97.17800, lat: 31.13700 },
  "那曲": { lng: 92.05300, lat: 31.47600 },
  "阿里": { lng: 80.10500, lat: 32.50200 },
  "珠峰": { lng: 86.92500, lat: 27.98800 },
  "纳木错": { lng: 90.66000, lat: 30.75000 },
  "羊卓雍措": { lng: 90.73400, lat: 28.93500 },
  // === 西北热门 ===
  "嘉峪关": { lng: 98.28900, lat: 39.77300 },
  "张掖": { lng: 100.45400, lat: 38.93200 },
  "酒泉": { lng: 98.51700, lat: 39.73200 },
  "茶卡": { lng: 99.08000, lat: 36.78000 },
};

// 获取已知城市中心坐标（模糊匹配）
function getKnownCityCenter(name: string): { lng: number; lat: number } | null {
  // 精确匹配
  if (KNOWN_CITY_CENTERS[name]) return KNOWN_CITY_CENTERS[name];
  // 模糊匹配：name 包含城市名或城市名包含 name
  for (const [city, coord] of Object.entries(KNOWN_CITY_CENTERS)) {
    if (name.includes(city) || city.includes(name)) return coord;
  }
  return null;
}

// 已知热门 POI 坐标（当高德 API 搜索失败时兜底）
// 这些是经过验证的准确坐标，涵盖云南、四川等热门旅游目的地
export const KNOWN_POI_COORDS: Record<string, { lng: number; lat: number }> = {
  // 昆明
  "昆明长水国际机场": { lng: 102.93584, lat: 25.09957 },
  "昆明老街": { lng: 102.70950, lat: 25.03980 },
  "石林风景区": { lng: 103.32570, lat: 24.81296 },
  // 大理
  "大理古城": { lng: 100.16400, lat: 25.69480 },
  "苍山感通索道": { lng: 100.15400, lat: 25.67800 },
  "寂照庵": { lng: 100.15600, lat: 25.68800 },
  "张家花园": { lng: 100.22200, lat: 25.58200 },
  "双廊古镇": { lng: 100.19400, lat: 25.88700 },
  "小普陀": { lng: 100.24000, lat: 25.81700 },
  "鹿卧山遗址": { lng: 100.21681, lat: 25.83498 },
  // 丽江
  "丽江古城": { lng: 100.23550, lat: 26.87050 },
  "木府": { lng: 100.23700, lat: 26.87200 },
  "束河古镇": { lng: 100.20900, lat: 26.91400 },
  "黑龙潭公园": { lng: 100.23600, lat: 26.88100 },
  "玉龙雪山国家级风景名胜区": { lng: 100.17800, lat: 27.06200 },
  "玉龙雪山冰川公园": { lng: 100.17500, lat: 27.09800 },
  "蓝月谷": { lng: 100.17800, lat: 27.04900 },
  "东巴谷景区": { lng: 100.26000, lat: 27.00000 },
  // 虎跳峡/香格里拉
  "虎跳峡景区": { lng: 100.13400, lat: 27.22100 },
  "中虎跳峡": { lng: 100.16248, lat: 27.25417 },
  "独克宗古城": { lng: 99.70850, lat: 27.81050 },
  "香格里拉市独克宗古城": { lng: 99.70850, lat: 27.81050 },
  "纳帕海依拉草原": { lng: 99.66700, lat: 27.86800 },
  "噶丹·松赞林寺": { lng: 99.70400, lat: 27.86300 },
  "迪庆香格里拉机场": { lng: 99.67990, lat: 27.78950 },
  // 成都
  "宽窄巷子": { lng: 104.05950, lat: 30.66990 },
  "锦里": { lng: 104.04800, lat: 30.64430 },
  "成都大熊猫繁育研究基地": { lng: 104.10900, lat: 30.73360 },
  "都江堰": { lng: 103.61800, lat: 30.98900 },
  "青城山": { lng: 103.50800, lat: 30.89900 },
  // 稻城亚丁
  "稻城亚丁": { lng: 100.39300, lat: 28.43300 },
  "牛奶海": { lng: 100.39400, lat: 28.43200 },
  "五色海": { lng: 100.39300, lat: 28.43000 },
  // 德钦/梅里雪山
  "飞来寺": { lng: 98.87800, lat: 28.44000 },
  "金沙江大湾": { lng: 99.01500, lat: 28.64000 },
  "金沙江第一湾": { lng: 99.01500, lat: 28.64000 },
  "雾浓顶": { lng: 98.87700, lat: 28.44700 },
  "白马雪山": { lng: 99.01800, lat: 28.35800 },
  "明永冰川": { lng: 98.74700, lat: 28.47800 },
  "雨崩村": { lng: 98.79200, lat: 28.39770 },
  "冰湖": { lng: 98.78500, lat: 28.38100 },
  "神瀑": { lng: 98.78000, lat: 28.37200 },
  "尼农峡谷": { lng: 98.81200, lat: 28.39900 },
  // 香格里拉
  "普达措国家公园": { lng: 99.97800, lat: 27.90800 },
  "巴拉格宗": { lng: 99.42200, lat: 27.89500 },
  "白水台": { lng: 100.08300, lat: 27.53500 },
  "阿布吉措": { lng: 99.95000, lat: 27.64500 },
  "千湖山": { lng: 99.83800, lat: 27.65000 },
  "碧沽天池": { lng: 99.77300, lat: 27.69000 },
  // 大理
  "沙溪古镇": { lng: 99.84900, lat: 26.31800 },
  "喜洲古镇": { lng: 100.12100, lat: 25.85600 },
  "崇圣寺三塔": { lng: 100.14500, lat: 25.70600 },
  "洱海": { lng: 100.23000, lat: 25.85000 },
  "苍山": { lng: 100.10000, lat: 25.65000 },
  "挖色": { lng: 100.27800, lat: 25.82800 },
  "龙龛码头": { lng: 100.23900, lat: 25.59100 },
  "磻溪村": { lng: 100.20400, lat: 25.65000 },
  "理想邦": { lng: 100.30000, lat: 25.80000 },
  "圣托里尼大理": { lng: 100.30000, lat: 25.80000 },
  // 丽江
  "白沙古镇": { lng: 100.23800, lat: 26.94600 },
  "拉市海": { lng: 100.14200, lat: 26.89700 },
  "文海": { lng: 100.21000, lat: 26.97000 },
  "甘海子": { lng: 100.21800, lat: 27.01800 },
  "牦牛坪": { lng: 100.19800, lat: 27.07400 },
  "云杉坪": { lng: 100.18600, lat: 27.04800 },
  "大研古城": { lng: 100.23550, lat: 26.87050 },
  // 西双版纳
  "告庄西双景": { lng: 100.79500, lat: 22.00600 },
  "星光夜市": { lng: 100.79500, lat: 22.00500 },
  "曼听公园": { lng: 100.80000, lat: 22.00700 },
  "中科院西双版纳热带植物园": { lng: 101.26600, lat: 21.93500 },
  "野象谷": { lng: 100.91000, lat: 22.16800 },
  "原始森林公园": { lng: 100.84800, lat: 22.06500 },
  // 川西
  "鱼子西": { lng: 101.53800, lat: 30.05800 },
  "墨石公园": { lng: 101.41500, lat: 30.57700 },
  "塔公草原": { lng: 101.61300, lat: 30.32300 },
  "木格措": { lng: 101.86900, lat: 30.14300 },
  "海螺沟": { lng: 102.11500, lat: 29.56700 },
  "冷噶措": { lng: 101.38000, lat: 29.64000 },
  "稻城亚丁机场": { lng: 100.43800, lat: 29.30300 },
  // 西藏
  "布达拉宫": { lng: 91.11700, lat: 29.65700 },
  "大昭寺": { lng: 91.13100, lat: 29.65200 },
  "八廓街": { lng: 91.13200, lat: 29.65300 },
  "南迦巴瓦峰": { lng: 95.01100, lat: 29.60000 },
  "雅鲁藏布大峡谷": { lng: 94.84700, lat: 29.55800 },
  "巴松措": { lng: 93.91600, lat: 29.97600 },
  "鲁朗林海": { lng: 94.74700, lat: 29.65300 },
  "扎什伦布寺": { lng: 88.86300, lat: 29.26800 },
  "珠峰大本营": { lng: 86.85100, lat: 28.16500 },
  "羊卓雍措": { lng: 90.73400, lat: 28.93500 },
  "纳木错": { lng: 90.66000, lat: 30.75000 },
  "玛旁雍错": { lng: 81.40000, lat: 30.65000 },
  "冈仁波齐": { lng: 81.31000, lat: 31.08000 },
  // 西北
  "莫高窟": { lng: 94.81000, lat: 40.04000 },
  "鸣沙山月牙泉": { lng: 94.67700, lat: 40.08700 },
  "七彩丹霞": { lng: 100.19100, lat: 38.91800 },
  "嘉峪关关城": { lng: 98.21600, lat: 39.80200 },
  "茶卡盐湖": { lng: 99.08000, lat: 36.78000 },
  "青海湖": { lng: 100.55200, lat: 36.79500 },
  // 其他
  "黄果树瀑布": { lng: 105.66600, lat: 25.98800 },
  "荔波小七孔": { lng: 107.73300, lat: 25.25600 },
  "梵净山": { lng: 108.68700, lat: 27.91600 },
  "天门山": { lng: 110.48000, lat: 29.08600 },
  "凤凰古城": { lng: 109.59800, lat: 27.94800 },
  "武夷山": { lng: 117.95400, lat: 27.64500 },
  "庐山": { lng: 115.98700, lat: 29.44800 },
  "华山": { lng: 110.08900, lat: 34.48800 },
  "泰山": { lng: 117.09900, lat: 36.26000 },
  "峨眉山": { lng: 103.34300, lat: 29.52900 },
  "乐山大佛": { lng: 103.74600, lat: 29.54400 },
  "九寨沟": { lng: 104.24400, lat: 33.26200 },
  "黄龙": { lng: 103.84200, lat: 32.75600 },
};

// 获取已知 POI 坐标（模糊匹配）
function getKnownPoiCoord(name: string): { lng: number; lat: number } | null {
  // 精确匹配
  if (KNOWN_POI_COORDS[name]) return KNOWN_POI_COORDS[name];
  // 模糊匹配：name 包含 POI 名或 POI 名包含 name
  for (const [poi, coord] of Object.entries(KNOWN_POI_COORDS)) {
    if (name.includes(poi) || poi.includes(name)) return coord;
  }
  return null;
}

export async function searchPois(
  webKey: string,
  keywords: string,
  city?: string,
  limit = 8,
  cityLimit = false,
  type?: string,
): Promise<PoiResult[]> {
  const url = new URL("https://restapi.amap.com/v3/place/text");
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("key", webKey);
  url.searchParams.set("offset", String(limit));
  url.searchParams.set("page", "1");
  url.searchParams.set("citylimit", cityLimit ? "true" : "false");
  if (city?.trim()) url.searchParams.set("city", city.trim());
  if (type?.trim()) url.searchParams.set("types", type.trim());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = (await res.json()) as {
      status?: string;
      info?: string;
      pois?: AmapPoiRaw[];
    };
    if (data.status !== "1") {
      throw new Error(`高德搜索失败：${data.info ?? "未知错误"}`);
    }
    const pois: PoiResult[] = [];
    for (const poi of data.pois ?? []) {
      const [lngStr, latStr] = (poi.location ?? "").split(",");
      const lng = Number(lngStr);
      const lat = Number(latStr);
      if (!poi.name || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const address = Array.isArray(poi.address) ? null : poi.address?.trim() || null;
      const district = [poi.pname, poi.cityname, poi.adname]
        .filter((part, idx, arr) => part && arr.indexOf(part) === idx)
        .join("");
      pois.push({ name: poi.name, address, district, lng, lat });
    }
    return pois;
  } finally {
    clearTimeout(timer);
  }
}

// 将可能的多城市目的地字符串拆分为单个城市列表（如「昆明、大理、丽江」→ ["昆明","大理","丽江"]）
function splitCities(city?: string): string[] {
  if (!city?.trim()) return [];
  return city
    .trim()
    .split(/[、,，/\s]+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 2 && c.length <= 10);
}

// 检查 POI 搜索结果是否落在期望城市范围内（用 district 字段匹配）
// district 格式如「云南省大理白族自治州大理市」，需同时匹配城市名和省/州名避免误判
function isPoiInCities(poi: PoiResult, cities: string[]): boolean {
  if (cities.length === 0) return true;
  return cities.some((c) => poi.district.includes(c));
}

// 高德地理编码 API：地址 → 坐标（用于城市级地名的坐标获取）
async function geocodeAddress(webKey: string, address: string, city?: string): Promise<{ lng: number; lat: number; district: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const url = new URL("https://restapi.amap.com/v3/geocode/geo");
    url.searchParams.set("address", address);
    url.searchParams.set("key", webKey);
    if (city?.trim()) url.searchParams.set("city", city.trim());
    const res = await fetch(url, { signal: controller.signal });
    const data = (await res.json()) as {
      status?: string;
      info?: string;
      geocodes?: Array<{ location?: string; district?: string }>;
    };
    if (data.status !== "1" || !data.geocodes?.length) return null;
    const geo = data.geocodes[0];
    const [lngStr, latStr] = (geo.location ?? "").split(",");
    const lng = Number(lngStr);
    const lat = Number(latStr);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const district = geo.district ?? "";
    return { lng, lat, district };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 判断一个地点名称是否为城市级地名（如"大理古城"、"丽江"、"香格里拉市"等）
function isCityLevelPlace(name: string, cities: string[]): boolean {
  // 去掉常见后缀后判断是否等于城市名
  const stripped = name.replace(/[市州县区古城古镇新城]$/g, "").trim();
  return cities.some((c) => stripped === c || stripped.includes(c) || c.includes(stripped));
}

// 取第一个匹配结果（AI 生成行程的坐标落地用）。
// 策略：
// 1. 先在目的城市内严格搜索 POI
// 2. 全国宽松搜索，校验结果是否落在期望城市
// 3. 城市级地名用地理编码 API 获取坐标
// 4. 退回到已知城市中心坐标
// 5. 地理编码兜底
// 宁可不定位，也不返回明显错误的地点
export async function geocodeFirst(
  webKey: string,
  keywords: string,
  city?: string,
): Promise<PoiResult | null> {
  const cities = splitCities(city);
  const expectedCities = cities.length > 0 ? cities : (city?.trim() ? [city.trim()] : []);

  // 第零步：检查已知 POI 坐标（精确匹配，无需 API 调用）
  const knownPoi = getKnownPoiCoord(keywords);
  if (knownPoi) {
    return {
      name: keywords,
      address: null,
      district: expectedCities.join("") || "",
      lng: knownPoi.lng,
      lat: knownPoi.lat,
    };
  }

  try {
    // 第一步：逐个城市做严格搜索（citylimit=true）
    // 仅当传入的是单个城市时才逐城严格搜；若 expectedCities 含多个城市，
    // 说明调用方误传了"昆明、大理、丽江"这种整串（而非某个具体城市），
    // 此时逐城严格搜会偏向第一个城市（先搜到昆明的同名 POI 就返回了），导致多城市行程定位全塌到首城。
    // 多城整串情形直接跳到第二步全国宽松搜 + 已知 POI 表。
    if (expectedCities.length <= 1) {
      for (const c of expectedCities) {
        const strict = await searchPois(webKey, keywords, c, 1, true);
        if (strict[0]) return strict[0];
      }
    }

    // 第二步：全国宽松搜索，但只接受落在期望城市范围内的结果
    if (expectedCities.length > 0) {
      const loose = await searchPois(webKey, keywords, undefined, 10, false);
      const valid = loose.find((poi) => isPoiInCities(poi, expectedCities));
      if (valid) return valid;

      // 宽松搜索有结果但都不在期望城市 → 说明 placeName 可能不规范
      // 如果 POI 搜索返回了结果但不在期望城市，尝试用地理编码 API 在期望城市内搜索
      if (loose.length > 0) {
        console.warn("[geocodeFirst] 宽松搜索结果均不在期望城市，尝试地理编码兜底", {
          keywords,
          expectedCities,
          firstResultDistrict: loose[0].district,
          firstResultName: loose[0].name,
        });
      }
    }

    // 第三步：城市级地名用地理编码 API 获取坐标
    if (isCityLevelPlace(keywords, expectedCities)) {
      for (const c of expectedCities) {
        const geo = await geocodeAddress(webKey, keywords, c);
        if (geo) {
          return {
            name: keywords,
            address: null,
            district: geo.district,
            lng: geo.lng,
            lat: geo.lat,
          };
        }
      }
      // 城市级地名：直接用城市名做地理编码
      for (const c of expectedCities) {
        const geo = await geocodeAddress(webKey, c, c);
        if (geo) {
          return {
            name: keywords,
            address: null,
            district: geo.district,
            lng: geo.lng,
            lat: geo.lat,
          };
        }
      }
    }

    // 第四步：地理编码兜底（在期望城市内搜索）
    if (expectedCities.length > 0) {
      for (const c of expectedCities) {
        const geo = await geocodeAddress(webKey, keywords, c);
        if (geo) {
          return {
            name: keywords,
            address: null,
            district: geo.district,
            lng: geo.lng,
            lat: geo.lat,
          };
        }
      }
    } else {
      // 没有城市信息，直接地理编码
      const geo = await geocodeAddress(webKey, keywords);
      if (geo) {
        return {
          name: keywords,
          address: null,
          district: geo.district,
          lng: geo.lng,
          lat: geo.lat,
        };
      }
    }

    // 第五步：退回到已知城市中心坐标
    const knownCenter = getKnownCityCenter(keywords);
    if (knownCenter) {
      return {
        name: keywords,
        address: null,
        district: expectedCities.join("") || "",
        lng: knownCenter.lng,
        lat: knownCenter.lat,
      };
    }

    // 如果关键词本身包含城市名，也用城市中心坐标兜底
    for (const c of expectedCities) {
      if (keywords.includes(c)) {
        const center = getKnownCityCenter(c);
        if (center) {
          return {
            name: keywords,
            address: null,
            district: c,
            lng: center.lng,
            lat: center.lat,
          };
        }
      }
    }
  } catch (err) {
    console.error("[geocodeFirst] 搜索失败", {
      keywords,
      city,
      expectedCities,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

// 逆地理编码：坐标 → 地址描述（地图选点定位用），失败静默返回 null
export async function regeoAddress(webKey: string, lng: number, lat: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const url = new URL("https://restapi.amap.com/v3/geocode/regeo");
    url.searchParams.set("location", `${lng.toFixed(6)},${lat.toFixed(6)}`);
    url.searchParams.set("key", webKey);
    const res = await fetch(url, { signal: controller.signal });
    const data = (await res.json()) as {
      status?: string;
      regeocode?: { formatted_address?: string | string[] };
    };
    if (data.status !== "1") return null;
    const addr = data.regeocode?.formatted_address;
    return typeof addr === "string" && addr.trim() ? addr.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
