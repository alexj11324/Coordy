import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  Textarea,
} from "@coordy/ui";
import { ArrowLeft, FileText, MessageSquare } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { draftAgentFromGoal } from "../lib/coordy/agent-draft";
import { createNamedAgent } from "../lib/coordy/start-task";
import { pickerRuntimes } from "../lib/coordy/labels";
import { useSession } from "../state/session-store";
import { RuntimePicker } from "./runtime-picker";

type Step = "start" | "ai" | "form";

export function CreateAgentPage() {
  const workspaceId = useSession((s) => s.workspaceId);
  const principalId = useSession((s) => s.principalId);
  const navigate = useNavigate();
  const catalog = useQuery({
    queryKey: ["discover-agents"],
    queryFn: () => window.coordy.discoverAgents(false),
  });
  const [step, setStep] = useState<Step>("start");
  const [goal, setGoal] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [harness, setHarness] = useState("");
  const [error, setError] = useState<string | null>(null);
  const runtimes = useMemo(() => pickerRuntimes(catalog.data, harness), [catalog.data, harness]);
  const selectedHarness = harness || runtimes[0]?.id || "";

  const create = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !principalId) throw new Error("还没准备好，请稍等一下");
      if (!name.trim()) throw new Error("请填写名称");
      if (!selectedHarness) throw new Error("请选择运行时");
      return createNamedAgent({
        workspaceId,
        principalId,
        name: name.trim(),
        harness: selectedHarness,
        description,
        instructions,
      });
    },
    onSuccess: (agentId) => {
      useSession.getState().setAgent(agentId, principalId ?? "");
      navigate(`/agents/${agentId}`);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  const startBlank = () => {
    setError(null);
    setName("");
    setDescription("");
    setInstructions("");
    setStep("form");
  };

  const continueFromAi = () => {
    const draft = draftAgentFromGoal(goal);
    if (!draft.instructions) {
      setError("先用一两句话描述这个智能体要负责什么。");
      return;
    }
    setError(null);
    setName(draft.name);
    setDescription(draft.description);
    setInstructions(draft.instructions);
    setStep("form");
  };

  return (
    <section className="space-y-6">
      <div>
        <Link to="/agents" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          智能体
        </Link>
        <PageHeader title="创建智能体" description="先选起点。最少只需要名称和运行时，其余可以创建后再改。" />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {step === "start" ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">你想从哪里开始？</h2>
            <p className="text-sm text-muted-foreground">
              从空白配置开始，或者直接描述需求，通过对话完成创建。
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-4" />
                  从空白开始
                </CardTitle>
                <CardDescription>
                  自己配置每个字段。适合已经明确知道智能体应该如何工作的用户。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="secondary" onClick={startBlank}>
                  继续
                </Button>
              </CardContent>
            </Card>
            <Card className="relative">
              <Badge className="absolute right-4 top-4" variant="secondary">
                推荐
              </Badge>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="size-4" />
                  通过 AI 创建
                </CardTitle>
                <CardDescription>
                  描述你想要的结果。我们会据此填好名称和指令草稿，你确认后再选运行时。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => setStep("ai")}>继续</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {step === "ai" ? (
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            continueFromAi();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="agent-goal">这个智能体主要帮你做什么？</Label>
            <Textarea
              id="agent-goal"
              rows={6}
              placeholder="例如：审查前端 Pull Request，只检查 TypeScript 和现有组件是否一致，不要直接改代码。"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">继续</Button>
            <Button type="button" variant="secondary" onClick={() => setStep("start")}>
              返回
            </Button>
          </div>
        </form>
      ) : null}

      {step === "form" ? (
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">名称</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="在当前工作区中必须唯一"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-description">描述</Label>
            <Input
              id="agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="写给自己看的简介，不会进入执行提示"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-instructions">指令</Label>
            <Textarea
              id="agent-instructions"
              rows={6}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="职责、边界、先检查什么、什么时候要你确认。每次执行都会带上。"
            />
          </div>
          <div className="space-y-1.5">
            <Label>运行时</Label>
            <p className="text-sm text-muted-foreground">
              运行时是这台电脑加上一款已检测到的工具。离线只是现在跑不了，并不是被删了。
            </p>
            <RuntimePicker items={runtimes} value={selectedHarness} onChange={setHarness} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={create.isPending || !name.trim() || !selectedHarness}>
              创建
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep("start")}>
              取消
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
