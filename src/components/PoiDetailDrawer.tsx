"use client";

// 地点详情抽屉（参考行谱 POI 详情页）：AI 攻略卡（预约/开放时间/门票/贴士）+ 社交搜索外链 + 导航直达
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Input,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  BulbOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  CompassOutlined,
  EditOutlined,
  EnvironmentOutlined,
  FieldTimeOutlined,
  MoneyCollectOutlined,
  ReloadOutlined,
  StarOutlined,
} from "@ant-design/icons";
import { itemTypeMeta } from "@/types/constants";
import { postSse } from "@/lib/sse-client";
import type { PoiGuide } from "@/lib/ai/poiguide";
import type { ItineraryItemT } from "@/types";

interface Props {
  open: boolean;
  item: ItineraryItemT | null;
  cityHint?: string;
  readOnly?: boolean;
  onClose: () => void;
  onEdit?: (item: ItineraryItemT) => void;
  onChanged?: () => void; // 备注等就地修改后通知父级刷新
}

const SOCIALS = [
  { label: "小红书", url: (q: string) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(q)}` },
  { label: "抖音", url: (q: string) => `https://www.douyin.com/search/${encodeURIComponent(q)}` },
  { label: "百度", url: (q: string) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
  { label: "微博", url: (q: string) => `https://s.weibo.com/weibo?q=${encodeURIComponent(q)}` },
];

function InfoTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div
      style={{
        flex: "1 1 45%",
        minWidth: 180,
        background: "#f8f8fc",
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 12, color: "#888" }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

export default function PoiDetailDrawer({
  open,
  item,
  cityHint,
  readOnly,
  onClose,
  onEdit,
  onChanged,
}: Props) {
  const { message } = App.useApp();
  const [guide, setGuide] = useState<PoiGuide | null>(null);
  const [guideAt, setGuideAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  // 备注就地编辑
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaved, setNotesSaved] = useState<string | null>(null); // 本次会话内已保存的备注（覆盖 item.notes 显示）
  const [savingNotes, setSavingNotes] = useState(false);
  const itemIdRef = useRef<string | null>(null);

  const generate = useCallback(
    async (targetId: string) => {
      setGenerating(true);
      try {
        await postSse(
          `/api/items/${targetId}/guide`,
          {},
          (event) => {
            if (itemIdRef.current !== targetId) return;
            if (event.type === "error") {
              throw new Error(event.message ?? "攻略生成失败");
            }
            if (event.type === "result" && event.guide) {
              setGuide(event.guide as PoiGuide);
              setGuideAt(event.guideAt ?? null);
            }
          },
        );
      } catch (err) {
        message.error(err instanceof Error && err.message ? err.message : "攻略生成失败", 5);
      } finally {
        if (itemIdRef.current === targetId) setGenerating(false);
      }
    },
    [message],
  );

  useEffect(() => {
    if (!open || !item) return;
    itemIdRef.current = item.id;
    setGuide(null);
    setGuideAt(null);
    setEditingNotes(false);
    setNotesSaved(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/items/${item.id}/guide`);
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          guide?: PoiGuide | null;
          guideAt?: string | null;
        };
        if (itemIdRef.current !== item.id) return;
        if (data.ok && data.guide) {
          setGuide(data.guide);
          setGuideAt(data.guideAt ?? null);
        }
      } catch {
        // 忽略，用户可手动加载
      } finally {
        if (itemIdRef.current === item.id) setLoading(false);
      }
    })();
  }, [open, item]);

  if (!item) return null;
  const meta = itemTypeMeta(item.type);
  const query = item.placeName || item.title;
  const busy = loading || generating;
  const currentNotes = notesSaved ?? item.notes;

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: notesDraft }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error);
      setNotesSaved(notesDraft.trim() || null);
      setEditingNotes(false);
      message.success("备注已保存");
      onChanged?.();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "保存失败");
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      title={
        <Space size={8}>
          <Tag color={meta.color} style={{ marginRight: 0 }}>
            {meta.label}
          </Tag>
          <span>{item.title}</span>
        </Space>
      }
      extra={
        <Space>
          {!readOnly && onEdit && (
            <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(item)}>
              编辑
            </Button>
          )}
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={generating}
            onClick={() => generate(item.id)}
          >
            刷新攻略
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ display: "flex" }}>
        {/* 基础信息 */}
        <div style={{ fontSize: 13, color: "#555", lineHeight: 1.8 }}>
          {item.startTime && (
            <div>
              <ClockCircleOutlined /> {item.startTime}
              {item.endTime ? ` – ${item.endTime}` : ""}
            </div>
          )}
          {item.placeName && (
            <div>
              <EnvironmentOutlined /> {item.placeName}
              {item.address ? ` · ${item.address}` : ""}
            </div>
          )}
          {item.estimatedCost != null && (
            <div>
              <MoneyCollectOutlined /> 预估 ¥{item.estimatedCost}/人
            </div>
          )}
        </div>

        {/* 我的备注：就地编辑 */}
        {editingNotes ? (
          <div>
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 6 }}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              maxLength={500}
              placeholder="写点自己的备注：预约结果、想吃的店、集合时间…"
              autoFocus
            />
            <Space style={{ marginTop: 8 }}>
              <Button type="primary" size="small" loading={savingNotes} onClick={saveNotes}>
                保存
              </Button>
              <Button size="small" onClick={() => setEditingNotes(false)}>
                取消
              </Button>
            </Space>
          </div>
        ) : (
          <div
            onClick={() => {
              if (readOnly) return;
              setNotesDraft(currentNotes ?? "");
              setEditingNotes(true);
            }}
            style={{
              background: "#f8f8fc",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 13,
              cursor: readOnly ? "default" : "pointer",
              color: currentNotes ? "#444" : "#aaa",
              whiteSpace: "pre-wrap",
            }}
            title={readOnly ? undefined : "点击编辑备注"}
          >
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }}>
              📝 我的备注{readOnly ? "" : "（点击编辑）"}
            </Typography.Text>
            {currentNotes || (readOnly ? "（无）" : "点这里写点自己的备注…")}
          </div>
        )}

        {/* 导航 + 社交外链 */}
        <Space wrap size={8}>
          {item.lng != null && item.lat != null && (
            <Button
              type="primary"
              size="small"
              icon={<CompassOutlined />}
              href={`https://uri.amap.com/marker?position=${item.lng},${item.lat}&name=${encodeURIComponent(query)}`}
              target="_blank"
            >
              高德导航
            </Button>
          )}
          {SOCIALS.map((s) => (
            <Button key={s.label} size="small" href={s.url(`${cityHint ?? ""} ${query}`.trim())} target="_blank">
              {s.label}
            </Button>
          ))}
        </Space>

        {/* AI 攻略 */}
        {busy && !guide && (
          <div>
            <Alert
              type="info"
              showIcon
              message={generating ? "AI 正在生成该地点的攻略…" : "加载中…"}
              style={{ marginBottom: 12 }}
            />
            <Skeleton active paragraph={{ rows: 5 }} />
          </div>
        )}

        {guide && (
          <>
            {guide.summary && (
              <Typography.Paragraph style={{ marginBottom: 0, fontSize: 13, color: "#444" }}>
                {guide.summary}
              </Typography.Paragraph>
            )}

            {guide.needReservation != null && (
              <Alert
                type={guide.needReservation ? "warning" : "success"}
                showIcon
                message={guide.needReservation ? "需要预约" : "无需预约"}
                description={guide.reservationNote ?? undefined}
              />
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <InfoTile icon={<ClockCircleOutlined />} label="开放时间" value={guide.openHours} />
              <InfoTile icon={<MoneyCollectOutlined />} label="门票" value={guide.ticketPrice} />
              <InfoTile
                icon={<FieldTimeOutlined />}
                label="建议时长"
                value={guide.suggestedDuration}
              />
              <InfoTile icon={<CalendarOutlined />} label="最佳时间" value={guide.bestTime} />
            </div>

            {guide.highlights.length > 0 && (
              <div>
                <Typography.Text strong>
                  <StarOutlined style={{ color: "#faad14", marginRight: 6 }} />
                  亮点
                </Typography.Text>
                <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
                  {guide.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}

            {guide.tips.length > 0 && (
              <div>
                <Typography.Text strong>
                  <BulbOutlined style={{ color: "#0d9488", marginRight: 6 }} />
                  小贴士
                </Typography.Text>
                <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
                  {guide.tips.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}

            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              AI 生成，仅供参考，门票与开放时间以官方为准
              {guideAt ? ` · ${new Date(guideAt).toLocaleString("zh-CN")}` : ""}
            </Typography.Text>
          </>
        )}

        {!busy && !guide && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无攻略信息"
            />
            <Button
              type="primary"
              icon={<BulbOutlined />}
              loading={generating}
              onClick={() => generate(item.id)}
              style={{ marginTop: 12 }}
            >
              加载攻略
            </Button>
          </div>
        )}
      </Space>
    </Drawer>
  );
}
