"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Col, Empty, Popconfirm, Progress, Row, Statistic, Table, Tag, Typography } from "antd";
import { PlusOutlined, SwapRightOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { EChartsOption } from "echarts";
import EChart from "@/components/EChart";
import ExpenseFormModal from "@/components/ExpenseFormModal";
import { expenseCategoryMeta, EXPENSE_CATEGORIES } from "@/types/constants";
import type { ExpenseT, TripDetail } from "@/types";

const CHART_PRIMARY = "#0d9488"; // 青绿主色

function fmtMoney(n: number): string {
  return `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

interface Props {
  trip: TripDetail;
  readOnly?: boolean; // 只读共享：隐藏记账与编辑入口
}

export default function ExpensesPanel({ trip, readOnly }: Props) {
  const { message } = App.useApp();
  const [expenses, setExpenses] = useState<ExpenseT[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; expense: ExpenseT | null }>({
    open: false,
    expense: null,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${trip.id}/expenses`);
      if (!res.ok) throw new Error();
      setExpenses(await res.json());
    } catch {
      message.error("加载开销记录失败");
    } finally {
      setLoading(false);
    }
  }, [trip.id, message]);

  useEffect(() => {
    load();
  }, [load]);

  const totalSpent = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);
  const budget = trip.budgetTotal;
  const members = useMemo(() => {
    const set = new Set<string>();
    for (const e of expenses) {
      if (e.payer) set.add(e.payer);
      for (const p of e.participants) set.add(p);
    }
    return [...set];
  }, [expenses]);

  // 分类支出（横向条形图，金额降序）
  const categoryOption = useMemo<EChartsOption>(() => {
    const sums = EXPENSE_CATEGORIES.map((c) => ({
      label: c.label,
      value: expenses.filter((e) => e.category === c.value).reduce((s, e) => s + e.amount, 0),
    }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
    return {
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "#f0f0f0" } },
        axisLabel: { color: "#8c8c8c" },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: sums.map((x) => x.label),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: "#595959" },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v) => fmtMoney(Number(v)),
      },
      series: [
        {
          type: "bar",
          data: sums.map((x) => Math.round(x.value * 100) / 100),
          barWidth: 16,
          itemStyle: { color: CHART_PRIMARY, borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: "right",
            color: "#595959",
            formatter: ({ value }) => fmtMoney(Number(value)),
          },
        },
      ],
    };
  }, [expenses]);

  // 每日支出（纵向柱状图，覆盖行程全部天 + 行程外日期）
  const dailyOption = useMemo<EChartsOption>(() => {
    const sums = new Map<string, number>();
    const start = dayjs(trip.startDate);
    const end = dayjs(trip.endDate);
    for (let d = start; !d.isAfter(end, "day"); d = d.add(1, "day")) {
      sums.set(d.format("YYYY-MM-DD"), 0);
    }
    for (const e of expenses) {
      const key = dayjs(e.date).format("YYYY-MM-DD");
      sums.set(key, (sums.get(key) ?? 0) + e.amount);
    }
    const keys = [...sums.keys()].sort();
    return {
      grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: keys.map((k) => dayjs(k).format("M/D")),
        axisTick: { show: false },
        axisLabel: { color: "#8c8c8c" },
        axisLine: { lineStyle: { color: "#e8e8e8" } },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "#f0f0f0" } },
        axisLabel: { color: "#8c8c8c" },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v) => fmtMoney(Number(v)),
      },
      series: [
        {
          type: "bar",
          data: keys.map((k) => Math.round((sums.get(k) ?? 0) * 100) / 100),
          barMaxWidth: 28,
          itemStyle: { color: CHART_PRIMARY, borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  }, [expenses, trip.startDate, trip.endDate]);

  // 分摊结算：净额 + 最少转账建议
  const settlement = useMemo(() => {
    const balance = new Map<string, number>(); // 正 = 应收，负 = 应付
    for (const e of expenses) {
      const payer = e.payer?.trim();
      const parts = e.participants.filter(Boolean);
      if (!payer || parts.length === 0) continue;
      const share = e.amount / parts.length;
      balance.set(payer, (balance.get(payer) ?? 0) + e.amount);
      for (const p of parts) balance.set(p, (balance.get(p) ?? 0) - share);
    }
    const creditors = [...balance.entries()]
      .filter(([, v]) => v > 0.01)
      .map(([name, v]) => ({ name, value: v }))
      .sort((a, b) => b.value - a.value);
    const debtors = [...balance.entries()]
      .filter(([, v]) => v < -0.01)
      .map(([name, v]) => ({ name, value: -v }))
      .sort((a, b) => b.value - a.value);
    const transfers: { from: string; to: string; amount: number }[] = [];
    let i = 0;
    let j = 0;
    while (i < creditors.length && j < debtors.length) {
      const pay = Math.min(creditors[i].value, debtors[j].value);
      transfers.push({ from: debtors[j].name, to: creditors[i].name, amount: pay });
      creditors[i].value -= pay;
      debtors[j].value -= pay;
      if (creditors[i].value < 0.01) i++;
      if (debtors[j].value < 0.01) j++;
    }
    return { balances: [...balance.entries()], transfers };
  }, [expenses]);

  const percent = budget != null && budget > 0 ? (totalSpent / budget) * 100 : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card size="small">
        <Row gutter={[24, 12]} align="middle">
          <Col xs={12} md={5}>
            <Statistic title="总预算" value={budget != null ? fmtMoney(budget) : "未设置"} />
          </Col>
          <Col xs={12} md={5}>
            <Statistic
              title="已花费"
              value={fmtMoney(totalSpent)}
              valueStyle={budget != null && totalSpent > budget ? { color: "#cf1322" } : undefined}
            />
          </Col>
          <Col xs={12} md={5}>
            <Statistic
              title={budget != null && totalSpent > budget ? "超支" : "剩余"}
              value={budget != null ? fmtMoney(Math.abs(budget - totalSpent)) : "—"}
              valueStyle={budget != null && totalSpent > budget ? { color: "#cf1322" } : undefined}
            />
          </Col>
          <Col xs={12} md={4}>
            <Statistic title="笔数" value={expenses.length} />
          </Col>
          <Col xs={24} md={5}>
            {percent != null && (
              <Progress
                percent={Math.round(percent)}
                status={percent > 100 ? "exception" : "normal"}
                format={(p) => `${p}%`}
              />
            )}
          </Col>
        </Row>
      </Card>

      {expenses.length > 0 && (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card size="small" title="分类支出">
              <EChart option={categoryOption} height={240} />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card size="small" title="每日支出">
              <EChart option={dailyOption} height={240} />
            </Card>
          </Col>
        </Row>
      )}

      <Card
        size="small"
        title="记账明细"
        extra={
          !readOnly && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setModal({ open: true, expense: null })}
            >
              记一笔
            </Button>
          )
        }
      >
        {expenses.length === 0 && !loading ? (
          <Empty description="还没有开销记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={expenses}
            pagination={false}
            columns={[
              {
                title: "日期",
                dataIndex: "date",
                width: 90,
                render: (v: string) => dayjs(v).format("M/D"),
              },
              {
                title: "分类",
                dataIndex: "category",
                width: 90,
                render: (v: string) => {
                  const meta = expenseCategoryMeta(v);
                  return <Tag color={meta.color}>{meta.label}</Tag>;
                },
              },
              { title: "标题", dataIndex: "title", ellipsis: true },
              {
                title: "金额",
                dataIndex: "amount",
                width: 110,
                align: "right" as const,
                render: (v: number) => fmtMoney(v),
              },
              { title: "垫付人", dataIndex: "payer", width: 90, render: (v: string | null) => v ?? "—" },
              {
                title: "分摊",
                dataIndex: "participants",
                width: 150,
                ellipsis: true,
                render: (v: string[]) => (v.length > 0 ? v.join("、") : "—"),
              },
              {
                title: "关联行程项",
                dataIndex: "itemId",
                width: 140,
                ellipsis: true,
                render: (v: string | null) => trip.items.find((i) => i.id === v)?.title ?? "—",
              },
              ...(readOnly
                ? []
                : [
                    {
                      title: "操作",
                      width: 110,
                      render: (_: unknown, record: ExpenseT) => (
                        <>
                          <a onClick={() => setModal({ open: true, expense: record })}>编辑</a>
                          <Popconfirm
                            title="删除这条记录？"
                            okText="删除"
                            okButtonProps={{ danger: true }}
                            cancelText="取消"
                            onConfirm={async () => {
                              const res = await fetch(`/api/expenses/${record.id}`, {
                                method: "DELETE",
                              });
                              if (res.ok) {
                                message.success("已删除");
                                load();
                              } else {
                                message.error("删除失败");
                              }
                            }}
                          >
                            <a style={{ marginLeft: 12, color: "#cf1322" }}>删除</a>
                          </Popconfirm>
                        </>
                      ),
                    },
                  ]),
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3}>
                  <Typography.Text strong>合计</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Typography.Text strong>{fmtMoney(totalSpent)}</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} colSpan={4} />
              </Table.Summary.Row>
            )}
          />
        )}
      </Card>

      {settlement.transfers.length > 0 && (
        <Card size="small" title="分摊结算建议">
          <Row gutter={[24, 8]}>
            <Col xs={24} md={12}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                各人净额（正 = 应收，负 = 应付）
              </Typography.Text>
              {settlement.balances.map(([name, v]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", maxWidth: 260 }}>
                  <span>{name}</span>
                  <Typography.Text type={v >= 0 ? "success" : "danger"}>
                    {v >= 0 ? "+" : "-"}
                    {fmtMoney(Math.abs(v))}
                  </Typography.Text>
                </div>
              ))}
            </Col>
            <Col xs={24} md={12}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                最少转账方案
              </Typography.Text>
              {settlement.transfers.map((t, idx) => (
                <div key={idx}>
                  <Typography.Text strong>{t.from}</Typography.Text>
                  <SwapRightOutlined style={{ margin: "0 8px", color: "#999" }} />
                  <Typography.Text strong>{t.to}</Typography.Text>
                  <Typography.Text style={{ marginLeft: 12 }}>{fmtMoney(t.amount)}</Typography.Text>
                </div>
              ))}
            </Col>
          </Row>
        </Card>
      )}

      <ExpenseFormModal
        open={modal.open}
        trip={trip}
        expense={modal.expense}
        members={members}
        onCancel={() => setModal((m) => ({ ...m, open: false }))}
        onSaved={() => {
          setModal((m) => ({ ...m, open: false }));
          load();
        }}
      />
    </div>
  );
}
