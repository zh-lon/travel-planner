"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Empty, Modal, Spin, Switch, Table, Typography } from "antd";
import type { UserPublic } from "@/types";

interface Props {
  open: boolean;
  tripId: string;
  onCancel: () => void;
}

interface ShareState {
  users: UserPublic[];
  shares: { userId: string; canEdit: boolean }[];
}

// 行程共享管理（所有者）：勾选共享对象，逐人设置只读/可编辑
export default function ShareModal({ open, tripId, onCancel }: Props) {
  const { message } = App.useApp();
  const [state, setState] = useState<ShareState | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/shares`);
      if (!res.ok) throw new Error();
      setState(await res.json());
    } catch {
      message.error("加载共享信息失败");
    } finally {
      setLoading(false);
    }
  }, [tripId, message]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const update = async (userId: string, canEdit: boolean | null) => {
    const res = await fetch(`/api/trips/${tripId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, canEdit }),
    }).catch(() => null);
    if (!res || !res.ok) {
      message.error("保存失败");
    }
    load();
  };

  const shareOf = (userId: string) => state?.shares.find((s) => s.userId === userId);

  return (
    <Modal title="共享行程" open={open} onCancel={onCancel} footer={null} width={520}>
      {loading && !state ? (
        <div style={{ textAlign: "center", padding: 32 }}>
          <Spin />
        </div>
      ) : !state || state.users.length === 0 ? (
        <Empty description="还没有其他用户，可让管理员在「管理」页创建" />
      ) : (
        <>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            被共享的用户可以在自己的行程列表中看到此行程；开启「可编辑」后对方可修改日程、开销与清单。
          </Typography.Paragraph>
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={state.users}
            pagination={false}
            columns={[
              {
                title: "用户",
                render: (_: unknown, u: UserPublic) => u.displayName || u.username,
              },
              {
                title: "共享",
                width: 90,
                render: (_: unknown, u: UserPublic) => (
                  <Switch
                    checked={!!shareOf(u.id)}
                    onChange={(checked) => update(u.id, checked ? false : null)}
                  />
                ),
              },
              {
                title: "可编辑",
                width: 90,
                render: (_: unknown, u: UserPublic) => {
                  const share = shareOf(u.id);
                  return (
                    <Switch
                      checked={!!share?.canEdit}
                      disabled={!share}
                      onChange={(checked) => update(u.id, checked)}
                    />
                  );
                },
              },
            ]}
          />
        </>
      )}
    </Modal>
  );
}
