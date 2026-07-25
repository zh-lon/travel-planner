"use client";

import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, Select, Space, Typography } from "antd";

type SettingsValues = Record<string, string | undefined>;

const PROTOCOL_HINTS: Record<string, { baseUrl: string; model: string }> = {
  openai: {
    baseUrl: "例如 https://api.deepseek.com/v1（填到 /v1 为止）",
    model: "例如 deepseek-chat",
  },
  anthropic: {
    baseUrl: "例如 https://api.anthropic.com（填域名即可）",
    model: "例如 claude-sonnet-5",
  },
};

export default function SettingsPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testingGeo, setTestingGeo] = useState(false);
  const [testingSearch, setTestingSearch] = useState(false);

  const protocol: string = Form.useWatch("ai.protocol", form) ?? "openai";
  const hints = PROTOCOL_HINTS[protocol] ?? PROTOCOL_HINTS.openai;

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data: SettingsValues) => {
        form.setFieldsValue({ "ai.protocol": "openai", ...data });
      })
      .catch(() => message.error("读取配置失败"))
      .finally(() => setLoading(false));
  }, [form, message]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form.getFieldsValue()),
      });
      if (!res.ok) throw new Error();
      message.success("配置已保存");
    } catch {
      message.error("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleTestAi = async () => {
    const values = form.getFieldsValue();
    setTestingAi(true);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocol: values["ai.protocol"],
          baseUrl: values["ai.baseUrl"],
          apiKey: values["ai.apiKey"],
          model: values["ai.model"],
        }),
      });
      const data = await res.json();
      if (data.ok) {
        message.success(`连接成功（${data.latencyMs}ms）：${data.reply || "已收到响应"}`);
      } else {
        message.error(`连接失败：${data.error}`, 6);
      }
    } catch {
      message.error("测试请求失败");
    } finally {
      setTestingAi(false);
    }
  };

  const handleTestGeo = async () => {
    const values = form.getFieldsValue();
    setTestingGeo(true);
    try {
      const res = await fetch("/api/geo/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webKey: values["amap.webKey"] }),
      });
      const data = await res.json();
      if (data.ok) {
        message.success("高德 Web 服务 Key 可用");
      } else {
        message.error(`测试失败：${data.error}`, 6);
      }
    } catch {
      message.error("测试请求失败");
    } finally {
      setTestingGeo(false);
    }
  };

  const handleTestSearch = async () => {
    const values = form.getFieldsValue();
    setTestingSearch(true);
    try {
      const res = await fetch("/api/search/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: values["search.provider"],
          apiKey: values["search.apiKey"],
        }),
      });
      const data = await res.json();
      if (data.ok) {
        message.success(`搜索可用（${data.latencyMs}ms）：${data.sample ?? ""}`);
      } else {
        message.error(`测试失败：${data.error}`, 6);
      }
    } catch {
      message.error("测试请求失败");
    } finally {
      setTestingSearch(false);
    }
  };

  return (
    <Form form={form} layout="vertical" disabled={loading}>
      <Space direction="vertical" size="large" style={{ display: "flex" }}>
        <Card title="AI 服务">
          <Typography.Paragraph type="secondary">
            配置你自己的 AI 服务。国内主流服务（DeepSeek、Kimi、通义等）和 one-api/new-api
            自建网关都使用 OpenAI 兼容协议。
          </Typography.Paragraph>
          <Form.Item label="协议类型" name="ai.protocol" initialValue="openai">
            <Select
              options={[
                { value: "openai", label: "OpenAI 兼容（DeepSeek / Kimi / 通义 / one-api 等）" },
                { value: "anthropic", label: "Anthropic（Claude 官方协议）" },
              ]}
              style={{ maxWidth: 420 }}
            />
          </Form.Item>
          <Form.Item label="服务地址（Base URL）" name="ai.baseUrl">
            <Input placeholder={hints.baseUrl} />
          </Form.Item>
          <Form.Item label="API Key" name="ai.apiKey">
            <Input.Password placeholder="仅保存在本机数据库中，不会上传" />
          </Form.Item>
          <Form.Item label="模型名" name="ai.model">
            <Input placeholder={hints.model} style={{ maxWidth: 420 }} />
          </Form.Item>
          <Button onClick={handleTestAi} loading={testingAi}>
            测试连通性
          </Button>
        </Card>

        <Card title="高德地图">
          <Typography.Paragraph type="secondary">
            前往{" "}
            <Typography.Link href="https://console.amap.com/dev/key/app" target="_blank">
              高德开放平台控制台
            </Typography.Link>{" "}
            免费注册个人开发者并创建应用，需要申请两种 Key：「Web端（JS
            API）」Key（含配套的安全密钥，用于页面地图渲染）和「Web服务」Key（用于地点搜索）。
          </Typography.Paragraph>
          <Form.Item label="JS API Key" name="amap.jsKey">
            <Input placeholder="Web端（JS API）类型的 Key" style={{ maxWidth: 420 }} />
          </Form.Item>
          <Form.Item label="JS API 安全密钥" name="amap.securityCode">
            <Input.Password
              placeholder="创建 JS API Key 时生成的安全密钥（jscode）"
              style={{ maxWidth: 420 }}
            />
          </Form.Item>
          <Form.Item label="Web 服务 Key" name="amap.webKey">
            <Input.Password placeholder="Web服务类型的 Key" style={{ maxWidth: 420 }} />
          </Form.Item>
          <Button onClick={handleTestGeo} loading={testingGeo}>
            测试 Web 服务 Key
          </Button>
        </Card>

        <Card title="和风天气（选填）">
          <Typography.Paragraph type="secondary">
            配置后行程看板会显示未来 7 天天气。前往{" "}
            <Typography.Link href="https://console.qweather.com" target="_blank">
              和风天气控制台
            </Typography.Link>{" "}
            免费注册，创建项目与凭据后可在「设置」中查看你的专属 API Host。
          </Typography.Paragraph>
          <Form.Item label="API Host" name="qweather.host">
            <Input placeholder="例如 abc123.re.qweatherapi.com（不含 https://）" style={{ maxWidth: 420 }} />
          </Form.Item>
          <Form.Item label="API Key" name="qweather.key">
            <Input.Password placeholder="和风天气 Key" style={{ maxWidth: 420 }} />
          </Form.Item>
        </Card>

        <Card title="联网搜索（选填）">
          <Typography.Paragraph type="secondary">
            配置后可在行程详情的「攻略参考」页签一键联网检索目的地攻略与景点评价，由 AI
            总结成参考报告。支持{" "}
            <Typography.Link href="https://tavily.com" target="_blank">
              Tavily
            </Typography.Link>
            （有免费额度）和{" "}
            <Typography.Link href="https://open.bochaai.com" target="_blank">
              博查
            </Typography.Link>
            。
          </Typography.Paragraph>
          <Form.Item label="服务商" name="search.provider" initialValue="tavily">
            <Select
              options={[
                { value: "tavily", label: "Tavily（有免费额度）" },
                { value: "bocha", label: "博查 Bocha（国内）" },
              ]}
              style={{ maxWidth: 420 }}
            />
          </Form.Item>
          <Form.Item label="API Key" name="search.apiKey">
            <Input.Password placeholder="搜索服务的 API Key" style={{ maxWidth: 420 }} />
          </Form.Item>
          <Button onClick={handleTestSearch} loading={testingSearch}>
            测试搜索
          </Button>
        </Card>

        <Button type="primary" size="large" onClick={handleSave} loading={saving}>
          保存全部配置
        </Button>
      </Space>
    </Form>
  );
}
