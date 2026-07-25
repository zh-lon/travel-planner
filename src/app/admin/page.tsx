"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { UserPublic } from "@/types";

interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
  _count?: { trips: number };
}

interface AdminTrip {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  owner: UserPublic | null;
  _count?: { items: number; shares: number; expenses: number };
}

export default function AdminPage() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [me, setMe] = useState<UserPublic | null | "loading">("loading");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [trips, setTrips] = useState<AdminTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, tripsRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/admin/trips"),
      ]);
      if (usersRes.ok) setUsers(await usersRes.json());
      if (tripsRes.ok) setTrips(await tripsRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data: { user?: UserPublic | null }) => setMe(data.user ?? null))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (me !== "loading" && me?.isAdmin) load();
  }, [me, load]);

  if (me === "loading") {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!me?.isAdmin) {
    return <Alert type="warning" showIcon message="需要管理员权限" />;
  }

  const updateUser = async (id: string, data: Record<string, unknown>, successText: string) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }).catch(() => null);
    if (res?.ok) {
      message.success(successText);
      load();
    } else {
      const err = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      message.error(err?.error ?? "操作失败");
    }
  };

  const resetPassword = (user: AdminUser) => {
    let value = "";
    modal.confirm({
      title: `重置「${user.displayName || user.username}」的密码`,
      content: (
        <Input.Password
          placeholder="新密码（至少 6 位）"
          onChange={(e) => {
            value = e.target.value;
          }}
        />
      ),
      okText: "重置",
      cancelText: "取消",
      onOk: async () => {
        if (value.length < 6) {
          message.error("密码至少 6 位");
          return Promise.reject();
        }
        await updateUser(user.id, { password: value }, "密码已重置");
      },
    });
  };

  const handleCreate = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error);
      message.success("用户已创建");
      form.resetFields();
      setCreateOpen(false);
      load();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card size="small" title="管理">
      <Tabs
        items={[
          {
            key: "users",
            label: `用户（${users.length}）`,
            children: (
              <>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  style={{ marginBottom: 12 }}
                  onClick={() => setCreateOpen(true)}
                >
                  新建用户
                </Button>
                <Table
                  rowKey="id"
                  size="small"
                  loading={loading}
                  dataSource={users}
                  pagination={false}
                  columns={[
                    {
                      title: "用户名",
                      dataIndex: "username",
                      render: (v: string, u: AdminUser) => (
                        <>
                          {v}
                          {u.id === me.id && <Tag style={{ marginLeft: 8 }}>自己</Tag>}
                          {u.disabled && (
                            <Tag color="error" style={{ marginLeft: 8 }}>
                              已禁用
                            </Tag>
                          )}
                        </>
                      ),
                    },
                    { title: "昵称", dataIndex: "displayName", render: (v: string | null) => v ?? "—" },
                    {
                      title: "管理员",
                      dataIndex: "isAdmin",
                      width: 90,
                      render: (v: boolean, u: AdminUser) => (
                        <Switch
                          checked={v}
                          disabled={u.id === me.id}
                          onChange={(checked) => updateUser(u.id, { isAdmin: checked }, "已更新")}
                        />
                      ),
                    },
                    {
                      title: "启用",
                      dataIndex: "disabled",
                      width: 80,
                      render: (v: boolean, u: AdminUser) => (
                        <Switch
                          checked={!v}
                          disabled={u.id === me.id}
                          onChange={(checked) => updateUser(u.id, { disabled: !checked }, "已更新")}
                        />
                      ),
                    },
                    { title: "行程数", width: 80, render: (_: unknown, u: AdminUser) => u._count?.trips ?? 0 },
                    {
                      title: "创建时间",
                      dataIndex: "createdAt",
                      width: 110,
                      render: (v: string) => dayjs(v).format("YYYY/M/D"),
                    },
                    {
                      title: "操作",
                      width: 150,
                      render: (_: unknown, u: AdminUser) => (
                        <>
                          <a onClick={() => resetPassword(u)}>重置密码</a>
                          {u.id !== me.id && (
                            <Popconfirm
                              title="删除该用户？"
                              description="其名下所有行程与共享将一并删除"
                              okText="删除"
                              okButtonProps={{ danger: true }}
                              cancelText="取消"
                              onConfirm={async () => {
                                const res = await fetch(`/api/admin/users/${u.id}`, {
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
                          )}
                        </>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: "trips",
            label: `行程（${trips.length}）`,
            children: (
              <Table
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={trips}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                columns={[
                  { title: "标题", dataIndex: "title", ellipsis: true },
                  { title: "目的地", dataIndex: "destination", width: 100 },
                  {
                    title: "所有者",
                    width: 120,
                    render: (_: unknown, t: AdminTrip) =>
                      t.owner ? t.owner.displayName || t.owner.username : "—",
                  },
                  {
                    title: "日期",
                    width: 170,
                    render: (_: unknown, t: AdminTrip) =>
                      `${dayjs(t.startDate).format("YYYY/M/D")} - ${dayjs(t.endDate).format("M/D")}`,
                  },
                  {
                    title: "行程项/共享/开销",
                    width: 130,
                    render: (_: unknown, t: AdminTrip) =>
                      `${t._count?.items ?? 0} / ${t._count?.shares ?? 0} / ${t._count?.expenses ?? 0}`,
                  },
                  {
                    title: "操作",
                    width: 110,
                    render: (_: unknown, t: AdminTrip) => (
                      <>
                        <a onClick={() => router.push(`/trips/${t.id}`)}>查看</a>
                        <Popconfirm
                          title="删除该行程？"
                          okText="删除"
                          okButtonProps={{ danger: true }}
                          cancelText="取消"
                          onConfirm={async () => {
                            const res = await fetch(`/api/trips/${t.id}`, { method: "DELETE" });
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
                ]}
              />
            ),
          },
        ]}
      />

      <Modal
        title="新建用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
        forceRender
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          系统不开放注册，账号由管理员在此创建后线下告知对方。
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true, message: "请输入用户名" },
              { pattern: /^[a-zA-Z0-9_-]{2,32}$/, message: "2~32 位字母/数字/下划线/短横线" },
            ]}
          >
            <Input maxLength={32} />
          </Form.Item>
          <Form.Item label="昵称" name="displayName">
            <Input maxLength={20} placeholder="选填" />
          </Form.Item>
          <Form.Item
            label="初始密码"
            name="password"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 6, message: "密码至少 6 位" },
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item label="设为管理员" name="isAdmin" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
