"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Empty, Input, Popconfirm, Segmented, Select, Skeleton, Tag, Typography } from "antd";
import {
  DeleteOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { postSse } from "@/lib/sse-client";
import type { TripDetail } from "@/types";

interface RecommendItem {
  name: string;
  type: string;
  city: string | null;
  description: string;
  reason: string;
  suggestedDuration: string | null;
  ticketPrice: string | null;
  tips: string | null;
  lng: number | null;
  lat: number | null;
  address: string | null;
}

interface WebResult {
  title: string;
  url: string;
  content: string;
  city: string;
}

interface Props {
  tripId: string;
  destination: string;
  dayCount: number;
  existingPois: string[];
  trip: TripDetail | null;
  onAdded: () => void;
  onTripChanged: () => void;
}

// 类型分类：搜索关键词 → 行程项 type
const CATEGORIES = [
  { key: "sight", label: "景点", searchQuery: "景点 必去 打卡 推荐", itemType: "SIGHT", color: "green" },
  { key: "food", label: "餐饮", searchQuery: "美食 必吃 推荐 餐厅", itemType: "FOOD", color: "orange" },
  { key: "hotel", label: "住宿", searchQuery: "住宿 酒店 民宿 推荐", itemType: "HOTEL", color: "purple" },
  { key: "shopping", label: "购物", searchQuery: "购物 商圈 特产 推荐", itemType: "SHOPPING", color: "magenta" },
] as const;

const ALL_KEY = "all";

// 搜索来源
const SOURCES = [
  { key: "map", label: "景点搜索" },
  { key: "ai", label: "AI 推荐" },
  { key: "web", label: "攻略搜索" },
  { key: "research", label: "攻略参考" },
] as const;

// 平台选项
const PLATFORMS = [
  { key: "all", label: "全部" },
  { key: "ctrip", label: "携程" },
  { key: "mafengwo", label: "马蜂窝" },
  { key: "xiaohongshu", label: "小红书" },
  { key: "dianping", label: "大众点评" },
  { key: "qunar", label: "去哪儿" },
  { key: "fliggy", label: "飞猪" },
  { key: "qyer", label: "穷游" },
] as const;

// 攻略参考来源模式
const RESEARCH_SOURCES = [
  { value: "web", label: "综合网页" },
  { value: "xhs", label: "小红书" },
  { value: "ai", label: "AI 直搜" },
] as const;

type SourceKey = (typeof SOURCES)[number]["key"];
type ResearchSourceType = (typeof RESEARCH_SOURCES)[number]["value"];

// 从地址中提取城市/地区简称
function shortCity(address: string | null): string | null {
  if (!address) return null;
  // 常见格式：省+市+区/县，取前两个有意义的部分
  const parts = address.replace(/省|市|自治区|特别行政区/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 2).join("");
  return parts[0] || null;
}

const CACHE_DEBOUNCE_MS = 2000;

interface CachePayload {
  source: SourceKey;
  activeCat: string;
  platform: string;
  keyword: string;
  pois: WebResult[];
  aiItems: RecommendItem[];
  webResults: Record<string, WebResult[]>; // 按平台分存，避免覆盖
  researchSource: ResearchSourceType;
}

export default function PoiExplorerPanel({
  tripId,
  destination,
  dayCount,
  existingPois,
  trip,
  onAdded,
  onTripChanged,
}: Props) {
  const { message } = App.useApp();
  const cacheLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [source, setSource] = useState<SourceKey>("map");
  const [activeCat, setActiveCat] = useState<string>("sight");
  const [platform, setPlatform] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  // 景点搜索结果
  const [pois, setPois] = useState<WebResult[]>([]);
  // AI 推荐结果
  const [aiItems, setAiItems] = useState<RecommendItem[]>([]);
  // 联网搜索结果（按平台分存，避免切换平台时覆盖）
  const [webResults, setWebResults] = useState<Record<string, WebResult[]>>({});
  // 通用状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchDay, setBatchDay] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addedSet, setAddedSet] = useState<Set<string>>(new Set(existingPois));
  const reqIdRef = useRef(0);

  // ===== 攻略参考状态 =====
  const [researchSource, setResearchSource] = useState<ResearchSourceType>("web");
  const [researchRunning, setResearchRunning] = useState(false);
  const [researchStatus, setResearchStatus] = useState("");
  const [researchStreamText, setResearchStreamText] = useState("");
  const researchSourceRef = useRef(researchSource);
  const abortRef = useRef<AbortController | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  // 保持 researchSourceRef 与 state 同步
  useEffect(() => {
    researchSourceRef.current = researchSource;
  }, [researchSource]);

  // 根据当前来源获取已有的研究结果
  const researchSummary = researchSource === "xhs" ? trip?.researchXhs ?? null : researchSource === "ai" ? trip?.researchAi ?? null : trip?.researchWeb ?? null;
  const researchAt = researchSource === "xhs" ? trip?.researchXhsAt ?? null : researchSource === "ai" ? trip?.researchAiAt ?? null : trip?.researchWebAt ?? null;

  // 从服务端恢复缓存
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${tripId}/poi-cache`);
        const json = (await res.json()) as { ok?: boolean; data?: string | null };
        if (cancelled) return;
        if (json.ok && json.data) {
          const cached = JSON.parse(json.data) as CachePayload;
          if (cached.source) setSource(cached.source);
          if (cached.activeCat) setActiveCat(cached.activeCat);
          if (cached.platform) setPlatform(cached.platform);
          if (cached.keyword) setKeyword(cached.keyword);
          if (Array.isArray(cached.pois)) setPois(cached.pois as WebResult[]);
          if (Array.isArray(cached.aiItems)) setAiItems(cached.aiItems);
          if (cached.researchSource) setResearchSource(cached.researchSource);
          // 兼容旧缓存：webResults 可能是数组
          if (cached.webResults) {
            if (Array.isArray(cached.webResults)) {
              // 旧格式：数组 → 转为 Record（用缓存的 platform 作 key）
              setWebResults({ [cached.platform || "all"]: cached.webResults as unknown as WebResult[] });
            } else {
              setWebResults(cached.webResults as Record<string, WebResult[]>);
            }
          }
        }
      } catch {
        // 加载失败，忽略缓存
      }
      cacheLoadedRef.current = true;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // 搜索结果变更时自动保存到服务端（防抖 2 秒）
  useEffect(() => {
    if (!cacheLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const payload: CachePayload = {
        source,
        activeCat,
        platform,
        keyword,
        pois,
        aiItems,
        webResults,
        researchSource,
      };
      fetch(`/api/trips/${tripId}/poi-cache`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: JSON.stringify(payload) }),
      }).catch(() => {
        // 静默失败
      });
    }, CACHE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [tripId, source, activeCat, platform, keyword, pois, aiItems, webResults, researchSource]);

  useEffect(() => {
    setAddedSet(new Set(existingPois));
  }, [existingPois]);

  // ===== 景点搜索（网络搜索） =====
  const doMapSearch = useCallback(
    async (kw?: string, cat?: string) => {
      const curKw = kw ?? keyword;
      const curCat = cat ?? activeCat;
      const catObj = CATEGORIES.find((c) => c.key === curCat);
      const reqId = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      try {
        // 构建搜索查询：关键词 + 目的地 + 分类搜索词
        const parts = [curKw.trim(), destination];
        if (catObj && curCat !== ALL_KEY) parts.push(catObj.searchQuery);
        else parts.push("景点 推荐 必去");
        const query = parts.filter(Boolean).join(" ");
        const params = new URLSearchParams();
        params.set("keywords", query);
        params.set("city", destination);
        params.set("platform", "all");
        const res = await fetch(`/api/geo/websearch?${params.toString()}`);
        const data = (await res.json()) as { ok?: boolean; results?: WebResult[]; error?: string };
        if (reqIdRef.current !== reqId) return;
        if (!data.ok || !data.results) {
          setError(data.error ?? "搜索失败");
          setPois([]);
        } else {
          setPois(data.results);
        }
      } catch {
        if (reqIdRef.current !== reqId) return;
        setError("网络错误，请重试");
        setPois([]);
      } finally {
        if (reqIdRef.current === reqId) setLoading(false);
      }
    },
    [keyword, activeCat, destination],
  );

  // ===== AI 推荐搜索（流式） =====
  const doAiSearch = useCallback(
    async (kw?: string, cat?: string) => {
      const curKw = kw ?? keyword;
      const curCat = cat ?? activeCat;
      const reqId = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      setAiItems([]);
      try {
        await postSse(
          "/api/ai/recommend",
          { destination, category: curCat, keywords: curKw.trim() },
          (event) => {
            if (reqIdRef.current !== reqId) return;
            if (event.type === "result" && Array.isArray(event.items)) {
              setAiItems(event.items as RecommendItem[]);
              message.success(`AI 推荐了 ${(event.items as RecommendItem[]).length} 个地点`);
            } else if (event.type === "error") {
              setError(event.message ?? "AI 推荐失败");
            }
          },
        );
      } catch (err) {
        if (reqIdRef.current !== reqId) return;
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "网络错误，请重试");
        }
      } finally {
        if (reqIdRef.current === reqId) setLoading(false);
      }
    },
    [keyword, activeCat, destination, message],
  );

  // ===== 联网搜索 =====
  const doWebSearch = useCallback(
    async (kw?: string, plat?: string) => {
      const curKw = kw ?? keyword;
      const curPlat = plat ?? platform;
      const reqId = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("keywords", curKw.trim());
        params.set("city", destination);
        params.set("platform", curPlat);
        const res = await fetch(`/api/geo/websearch?${params.toString()}`);
        const data = (await res.json()) as { ok?: boolean; results?: WebResult[]; error?: string };
        if (reqIdRef.current !== reqId) return;
        if (!data.ok || !data.results) {
          setError(data.error ?? "搜索失败");
          setWebResults((prev) => { const n = { ...prev }; delete n[curPlat]; return n; });
        } else {
          setWebResults((prev) => ({ ...prev, [curPlat]: data.results! }));
        }
      } catch {
        if (reqIdRef.current !== reqId) return;
        setError("网络错误，请重试");
        setWebResults((prev) => { const n = { ...prev }; delete n[curPlat]; return n; });
      } finally {
        if (reqIdRef.current === reqId) setLoading(false);
      }
    },
    [keyword, platform, destination],
  );

  // ===== 攻略参考研究 =====
  // 滚动到底部
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [researchStreamText, researchStatus]);

  // 清理 abort
  useEffect(() => () => abortRef.current?.abort(), []);

  const researchRun = async () => {
    setResearchRunning(true);
    setResearchStreamText("");
    setResearchStatus("正在准备…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSse(
        `/api/trips/${tripId}/research`,
        { source: researchSourceRef.current },
        (event) => {
          if (event.type === "status" && event.text) setResearchStatus(event.text);
          else if (event.type === "delta" && event.text) setResearchStreamText((prev) => prev + event.text);
          else if (event.type === "result") {
            message.success("研究完成，已保存");
            onTripChanged();
          } else if (event.type === "error") {
            message.error(event.message ?? "研究失败", 8);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        message.error(err instanceof Error ? err.message : "研究失败", 8);
      }
    } finally {
      setResearchRunning(false);
    }
  };

  const researchRemove = async () => {
    const res = await fetch(`/api/trips/${tripId}/research`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      message.success("已删除研究结果");
      onTripChanged();
    } else {
      message.error("删除失败");
    }
  };

  // 来源切换（不自动搜索）
  const handleSourceChange = (s: SourceKey) => {
    setSource(s);
    setSelected(new Set());
    setError(null);
  };

  // 类型切换（不自动搜索）
  const handleCatChange = (cat: string) => {
    setActiveCat(cat);
    setSelected(new Set());
  };

  // 搜索输入（不自动搜索，仅更新关键词）
  const handleSearchInput = (text: string) => {
    setKeyword(text);
  };

  // 平台切换（不自动搜索）
  const handlePlatformChange = (plat: string) => {
    setPlatform(plat);
    setSelected(new Set());
  };

  // 手动触发搜索
  const handleSearch = () => {
    setSelected(new Set());
    setError(null);
    if (source === "map") {
      doMapSearch(keyword, activeCat);
    } else if (source === "ai") {
      doAiSearch(keyword, activeCat);
    } else {
      doWebSearch(keyword, platform);
    }
  };

  const currentItemType = () => {
    const cat = CATEGORIES.find((c) => c.key === activeCat);
    return cat?.itemType ?? "SIGHT";
  };

  // 添加单个景点搜索结果
  const handleAddPoi = async (result: WebResult, dayIndex: number) => {
    try {
      const res = await fetch(`/api/trips/${tripId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dayIndex,
          type: currentItemType(),
          title: result.title,
          placeName: result.title,
          notes: `${result.content}\n${result.url}`,
        }),
      });
      if (!res.ok) throw new Error();
      message.success(`「${result.title.slice(0, 20)}…」已加入第 ${dayIndex + 1} 天`);
      setAddedSet((prev) => new Set(prev).add(result.title));
      onAdded();
    } catch {
      message.error("添加失败，请重试");
    }
  };

  // 添加单个 AI 推荐
  const handleAddAiItem = async (item: RecommendItem, dayIndex: number) => {
    try {
      const res = await fetch(`/api/trips/${tripId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dayIndex,
          type: item.type || currentItemType(),
          title: item.name,
          placeName: item.name,
          lng: item.lng,
          lat: item.lat,
          address: item.address ?? "",
          notes: [item.reason, item.tips].filter(Boolean).join("；") || undefined,
          estimatedCost: item.ticketPrice?.match(/\d+/)?.[0]
            ? Number(item.ticketPrice.match(/\d+/)![0])
            : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      message.success(`「${item.name}」已加入第 ${dayIndex + 1} 天`);
      setAddedSet((prev) => new Set(prev).add(item.name));
      onAdded();
    } catch {
      message.error("添加失败，请重试");
    }
  };

  // 添加单个联网搜索结果
  const handleAddWebResult = async (result: WebResult, dayIndex: number) => {
    try {
      const res = await fetch(`/api/trips/${tripId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dayIndex,
          type: "OTHER",
          title: result.title,
          notes: result.url,
        }),
      });
      if (!res.ok) throw new Error();
      message.success(`「${result.title.slice(0, 20)}…」已加入第 ${dayIndex + 1} 天`);
      setAddedSet((prev) => new Set(prev).add(result.title));
      onAdded();
    } catch {
      message.error("添加失败，请重试");
    }
  };

  // 批量添加（景点搜索）
  const handleBatchAdd = async () => {
    if (selected.size === 0) return;
    setAdding(true);
    let ok = 0;
    let fail = 0;
    for (const idx of Array.from(selected)) {
      const result = pois[idx];
      if (!result) continue;
      try {
        const res = await fetch(`/api/trips/${tripId}/items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dayIndex: batchDay,
            type: currentItemType(),
            title: result.title,
            placeName: result.title,
            notes: `${result.content}\n${result.url}`,
          }),
        });
        if (res.ok) {
          ok++;
          setAddedSet((prev) => new Set(prev).add(result.title));
        } else fail++;
      } catch {
        fail++;
      }
    }
    setAdding(false);
    setSelected(new Set());
    if (ok > 0) {
      message.success(`成功添加 ${ok} 个地点到第 ${batchDay + 1} 天${fail > 0 ? `，${fail} 个失败` : ""}`);
      onAdded();
    } else {
      message.error("批量添加失败");
    }
  };

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const currentCatColor = () => {
    const cat = CATEGORIES.find((c) => c.key === activeCat);
    return cat?.color ?? "default";
  };

  const renderSourceSwitcher = () => (
    <div className="poi-source-switcher">
      {SOURCES.map((s) => (
        <button
          key={s.key}
          className={`poi-source-btn${source === s.key ? " active" : ""}`}
          onClick={() => handleSourceChange(s.key)}
        >
          {s.key === "ai" && <RobotOutlined style={{ marginRight: 4 }} />}
          {s.key === "research" && <GlobalOutlined style={{ marginRight: 4 }} />}
          {s.label}
        </button>
      ))}
    </div>
  );

  const renderToolbar = () => (
    <div className="poi-explorer-toolbar">
      {source === "research" ? (
        <div className="poi-explorer-cats">
          <Segmented
            value={researchSource}
            onChange={(v) => setResearchSource(v as ResearchSourceType)}
            options={[...RESEARCH_SOURCES]}
          />
        </div>
      ) : (
        <>
          {source !== "web" && (
            <div className="poi-explorer-cats">
              <button
                className={`poi-cat-btn${activeCat === ALL_KEY ? " active" : ""}`}
                onClick={() => handleCatChange(ALL_KEY)}
              >
                全部
              </button>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  className={`poi-cat-btn${activeCat === cat.key ? " active" : ""}`}
                  onClick={() => handleCatChange(cat.key)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}
          {source === "web" && (
            <div className="poi-explorer-cats">
              {PLATFORMS.map((p) => (
                <button
                  key={p.key}
                  className={`poi-cat-btn${platform === p.key ? " active" : ""}`}
                  onClick={() => handlePlatformChange(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {source !== "research" && (
        <>
          <Input
            allowClear
            size="middle"
            prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
            placeholder={
              source === "web"
                ? `搜索${destination}攻略、景点推荐…`
                : source === "map"
                  ? `搜索${destination}景点、美食、住宿…`
                  : `搜索${destination}的景点、餐厅、酒店…`
            }
            value={keyword}
            onChange={(e) => handleSearchInput(e.target.value)}
            onPressEnter={handleSearch}
            style={{ maxWidth: 320 }}
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={loading}
            onClick={handleSearch}
          >
            搜索
          </Button>
        </>
      )}
    </div>
  );

  const renderMapResults = () => {
    if (loading) return renderSkeleton();
    if (pois.length === 0)
      return <div className="poi-explorer-empty">{error ? null : "点击上方「搜索」按钮，联网搜索景点"}</div>;
    return pois.map((result, idx) => {
      const added = addedSet.has(result.title);
      const checked = selected.has(idx);
      return (
        <div key={`${result.url}-${idx}`} className={`poi-explorer-item${added ? " added" : ""}`}>
          <Checkbox checked={checked} onChange={() => toggleSelect(idx)} disabled={added} style={{ flexShrink: 0 }} />
          <div className="poi-explorer-item-info">
            <div className="poi-explorer-item-name">
              <Tag color="blue" style={{ marginRight: 6, fontSize: 11 }}>{result.city}</Tag>
              {activeCat !== ALL_KEY && (
                <Tag color={currentCatColor()} style={{ marginRight: 6, fontSize: 11 }}>
                  {CATEGORIES.find((c) => c.key === activeCat)?.label}
                </Tag>
              )}
              <span>{result.title}</span>
            </div>
            <div className="poi-explorer-item-addr">
              {result.content}
            </div>
          </div>
          <div className="poi-explorer-item-action">
            {added ? (
              <Tag color="success" style={{ margin: 0 }}>已加入</Tag>
            ) : (
              <Select
                size="small"
                value={undefined}
                placeholder="加入第…天"
                style={{ width: 110 }}
                suffixIcon={<PlusOutlined />}
                onChange={(val) => handleAddPoi(result, val as unknown as number)}
                options={Array.from({ length: dayCount }, (_, d) => ({ value: d, label: `第 ${d + 1} 天` }))}
              />
            )}
          </div>
        </div>
      );
    });
  };

  const renderAiResults = () => {
    if (loading) return renderSkeleton();
    if (aiItems.length === 0)
      return <div className="poi-explorer-empty">{error ? null : "点击上方「搜索」按钮，让 AI 为你推荐景点"}</div>;
    return aiItems.map((item, idx) => {
      const added = addedSet.has(item.name);
      const checked = selected.has(idx);
      const hasCoord = item.lng != null && item.lat != null;
      return (
        <div key={`${item.name}-${idx}`} className={`poi-ai-item${added ? " added" : ""}`}>
          <Checkbox checked={checked} onChange={() => toggleSelect(idx)} disabled={added} style={{ flexShrink: 0, alignSelf: "flex-start" }} />
          <div className="poi-ai-item-body">
            <div className="poi-ai-item-head">
              {(item.city || shortCity(item.address)) && (
                <Tag color="blue" style={{ fontSize: 11 }}>{item.city || shortCity(item.address)}</Tag>
              )}
              <Tag color={CATEGORIES.find((c) => c.key === activeCat)?.color ?? "default"} style={{ fontSize: 11 }}>
                {CATEGORIES.find((c) => c.key === activeCat)?.label ?? "推荐"}
              </Tag>
              <span className="poi-ai-item-name">{item.name}</span>
              {!hasCoord && <Tag color="orange" style={{ fontSize: 11, marginLeft: 4 }}>未定位坐标</Tag>}
            </div>
            {item.description && <div className="poi-ai-item-desc">{item.description}</div>}
            {item.reason && (
              <div className="poi-ai-item-reason">
                <span style={{ color: "#0d9488", fontWeight: 600, marginRight: 4 }}>推荐理由</span>
                {item.reason}
              </div>
            )}
            <div className="poi-ai-item-meta">
              {item.suggestedDuration && (
                <span className="poi-ai-meta-item">⏱ {item.suggestedDuration}</span>
              )}
              {item.ticketPrice && (
                <span className="poi-ai-meta-item">🎫 {item.ticketPrice}</span>
              )}
              {item.address && (
                <span className="poi-ai-meta-item">
                  <EnvironmentOutlined style={{ fontSize: 11 }} /> {item.address}
                </span>
              )}
            </div>
            {item.tips && <div className="poi-ai-item-tips">💡 {item.tips}</div>}
          </div>
          <div className="poi-explorer-item-action">
            {added ? (
              <Tag color="success" style={{ margin: 0 }}>已加入</Tag>
            ) : (
              <Select
                size="small"
                value={undefined}
                placeholder="加入第…天"
                style={{ width: 110 }}
                suffixIcon={<PlusOutlined />}
                onChange={(val) => handleAddAiItem(item, val as unknown as number)}
                options={Array.from({ length: dayCount }, (_, d) => ({ value: d, label: `第 ${d + 1} 天` }))}
              />
            )}
          </div>
        </div>
      );
    });
  };

  const renderWebResults = () => {
    if (loading) return renderSkeleton();
    const curResults = webResults[platform] ?? [];
    if (curResults.length === 0)
      return <div className="poi-explorer-empty">{error ? null : "点击上方「搜索」按钮，联网搜索攻略"}</div>;
    return curResults.map((result, idx) => {
      const added = addedSet.has(result.title);
      return (
        <div key={`${result.url}-${idx}`} className="poi-web-item">
          <div className="poi-web-item-body">
            <Tag color="blue" style={{ fontSize: 11, marginBottom: 4 }}>{result.city}</Tag>
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="poi-web-item-title"
            >
              <LinkOutlined style={{ marginRight: 6, fontSize: 13 }} />
              {result.title}
            </a>
            <div className="poi-web-item-content">{result.content}</div>
            <div className="poi-web-item-url">{result.url}</div>
          </div>
          <div className="poi-explorer-item-action">
            {added ? (
              <Tag color="success" style={{ margin: 0 }}>已加入</Tag>
            ) : (
              <Select
                size="small"
                value={undefined}
                placeholder="加入第…天"
                style={{ width: 110 }}
                suffixIcon={<PlusOutlined />}
                onChange={(val) => handleAddWebResult(result, val as unknown as number)}
                options={Array.from({ length: dayCount }, (_, d) => ({ value: d, label: `第 ${d + 1} 天` }))}
              />
            )}
          </div>
        </div>
      );
    });
  };

  const renderResearchResults = () => {
    // 正在研究
    if (researchRunning) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Alert type="info" showIcon message={researchStatus || "研究中…"} />
          <pre
            ref={preRef}
            style={{
              maxHeight: 420,
              overflowY: "auto",
              background: "#fafafa",
              border: "1px solid #f0f0f0",
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: 0,
              minHeight: 120,
            }}
          >
            {researchStreamText || "正在联网搜索资料…"}
          </pre>
          <Button
            block
            onClick={() => {
              abortRef.current?.abort();
              setResearchRunning(false);
            }}
          >
            取消
          </Button>
        </div>
      );
    }

    // 没有研究结果
    if (!researchSummary) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              还没有研究结果
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                自动联网搜索目的地攻略与各景点的网友评价，由 AI 总结成一份带来源的参考报告
                <br />
                （需管理员在设置页配置「联网搜索」服务）
              </Typography.Text>
            </span>
          }
          style={{ padding: "40px 0" }}
        >
          <Button type="primary" icon={<GlobalOutlined />} onClick={researchRun}>
            开始联网研究
          </Button>
        </Empty>
      );
    }

    // 已研究
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            研究于 {researchAt ? dayjs(researchAt).format("YYYY年M月D日 HH:mm") : "—"} ·
            内容由网络搜索与 AI 总结生成，仅供参考
          </Typography.Text>
          <span style={{ flex: 1 }} />
          <Button size="small" icon={<ReloadOutlined />} onClick={researchRun}>
            重新研究
          </Button>
          <Popconfirm title="删除研究结果？" okText="删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={researchRemove}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </div>
        <Typography>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
            }}
          >
            {researchSummary}
          </ReactMarkdown>
        </Typography>
      </div>
    );
  };

  const renderSkeleton = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} active paragraph={{ rows: 1 }} title={{ width: "60%" }} />
      ))}
    </div>
  );

  return (
    <div className="poi-explorer">
      {renderSourceSwitcher()}
      {renderToolbar()}

      {error && (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />
      )}

      <div className="poi-explorer-list">
        {source === "map" && renderMapResults()}
        {source === "ai" && renderAiResults()}
        {source === "web" && renderWebResults()}
        {source === "research" && renderResearchResults()}
      </div>

      {selected.size > 0 && source !== "web" && source !== "research" && (
        <div className="poi-explorer-batch">
          <Typography.Text>
            已选 <strong>{selected.size}</strong> 个地点
          </Typography.Text>
          <span style={{ flex: 1 }} />
          <Select
            size="small"
            value={batchDay}
            onChange={setBatchDay}
            style={{ width: 100 }}
            options={Array.from({ length: dayCount }, (_, d) => ({ value: d, label: `第 ${d + 1} 天` }))}
          />
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            loading={adding}
            onClick={handleBatchAdd}
          >
            批量加入
          </Button>
        </div>
      )}
    </div>
  );
}
