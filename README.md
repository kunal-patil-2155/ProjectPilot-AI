# ProjectPilot AI

> **Your projects. Your priorities. One intelligent assistant.**

Developed for the **Build, Ship, Shape: Amazon Developer Hackathon 2026** — *Alexa+ Track*.

---

## 1. Executive Overview

**ProjectPilot AI** is a polished, operations assistant and developer dashboard built for software engineers managing multiple software projects, unfinished tasks, critical blockers, and technical maintenance.

Unlike conventional dashboards that use ad-hoc internal APIs, ProjectPilot AI is powered by the **Model Context Protocol (MCP)** using the official **Streamable HTTP** transport (`specification 2025-11-25`). Every project query, priority recommendation, status transition, and conversational workflow executes through verified, deterministic MCP tool calls over HTTP.

### Product Highlights
* **Autonomous Project Rescue (Signature Capability)**: Deterministic, evidence-based project rescue: `Investigate → Diagnose → Plan → Approve → Execute → Verify`. Synthesizes remediation plans, isolates executable actions from manual recommendations, enforces explicit user approval, executes sequentially, re-reads storage to verify persistence, and recalculates live project health.
* **Alexa+ Developer Operations Simulation**: Natural-language operational commands (daily priorities, project investigations, task completions, remaining work, maintenance tracking, and project rescue) mapped directly to MCP tool executions.
* **Streamable HTTP MCP Server**: Conforms to MCP specification `2025-11-25` with full stateful session management, protocol version negotiation, and tool discovery.
* **Native Browser MCP Client**: Pure ES module client communicating over `/mcp` via HTTP POST and Server-Sent Events (SSE).
* **Transparent Priority Recommendations**: Explainable ranking algorithm considering priority tiers, deadline urgency, user-reported bugs, and blocker penalties.
* **Truthful Project Health Metrics**: Derives metrics strictly from persisted records, distinguishing user-reported bugs, incomplete tasks, and explicit blockers without fabricating external automated audits.
* **Zero Heavy Framework Overhead**: Built with vanilla HTML5/CSS3/ES modules on the frontend and native Node.js HTTP on the backend. No React, TypeScript, or heavy bundlers.

---

## 2. Architecture & Technology Stack

```
┌────────────────────────────────────────────────────────────────┐
│               Frontend (Vanilla ES Modules)                    │
│  • Developer Dashboard (Dark Theme, Accessible Modals)         │
│  • Alexa+ Conversational Assistant Interface (Web Speech API)  │
│  • Real-time MCP Protocol Inspector & Telemetry Logger         │
└───────────────────────────────┬────────────────────────────────┘
                                │ JSON-RPC 2.0 (Streamable HTTP)
                                │ Header: mcp-session-id, mcp-protocol-version
                                ▼
┌────────────────────────────────────────────────────────────────┐
│             Node.js Backend & HTTP Gateway                     │
│  • Native Node.js HTTP Server (`src/server.js`)                │
│  • Static File Server with Path Traversal Protection           │
│  • /mcp Streamable HTTP Gateway (Stateful Session Management)  │
└───────────────────────────────┬────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────┐
│           Model Context Protocol Server (`src/mcp/`)           │
│  • @modelcontextprotocol/sdk (Specification 2025-11-25)        │
│  • 12 Executable Tools with Zod Schema Validation              │
└───────┬───────────────────────┼────────────────────────┬───────┘
        ▼                       ▼                        ▼
┌──────────────┐        ┌──────────────┐        ┌────────────────┐
│Health Service│        │Priority Serv.│        │Maintenance Srv.│
└───────┬──────┘        └───────┬──────┘        └────────┬───────┘
        └───────────────────────┼────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────┐
│       Data Storage & Atomic Persistence (`src/db/store.js`)    │
│  • Local JSON Store (`data/store.json`)                        │
│  • Atomic writes via temp file rename pattern                  │
│  • Persistent across restarts (never overwrites user data)     │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. Implemented MCP Tools (12 Tools)

Every tool performs real operations against the data store and returns structured results:

| # | MCP Tool Name | Description | Key Inputs |
|---|---------------|-------------|------------|
| 1 | `list_projects` | Lists all projects with optional status, category, or priority filters. | `status`, `category`, `priority` |
| 2 | `get_project_details` | Retrieves full project records, task lists, blockers, and health. | `projectId` (required) |
| 3 | `create_project` | Creates and persists a new software project. | `name` (req), `description`, `category`, `techStack`, `priority`, `repoUrl` |
| 4 | `update_project` | Updates properties of an existing project. | `projectId` (req), `name`, `status`, `priority`, etc. |
| 5 | `list_tasks` | Lists tasks with filters (project, status, priority, maintenance, bug). | `projectId`, `status`, `priority`, `isMaintenance`, `isBug` |
| 6 | `create_task` | Creates and persists a task associated with an existing project. | `projectId` (req), `title` (req), `priority`, `status`, `dueDate`, `blocker` |
| 7 | `update_task_status` | Updates task status (`todo`, `in_progress`, `blocked`, `done`) and records/clears blockers. | `taskId` (req), `status` (req), `blockerReason` |
| 8 | `list_blockers` | Lists all active blockers across projects or within a specific project. | `projectId` (optional) |
| 9 | `get_project_health` | Derives truthful health metrics (distinguishes bugs, blockers, incomplete tasks). | `projectId` (optional) |
| 10 | `get_priority_recommendations` | Computes explainable prioritization rankings for unfinished tasks with justifications. | `projectId` (optional), `limit` |
| 11 | `list_maintenance_tasks` | Categorizes maintenance tasks by overdue, due soon (≤7d), and scheduled status. | `projectId` (optional), `includeCompleted` |
| 12 | `generate_rescue_plan` | Synthesizes an evidence-based rescue plan with proposed actions, health projections, and manual recommendations. | `projectId` (optional), `projectName` (optional) |

---

## 4. Conversational Workflows (Alexa+ Track)

The assistant orchestrates multi-step MCP tool calls and presents clean natural language summaries:

0. **Workflow 0: Autonomous Project Rescue (Signature Capability)**
   - *Sample Utterance:* `"Rescue project Mobile Checkout SDK"` or `"Prepare a rescue plan for DevPulse"`
   - *Execution:* Resolves project ID, invokes `generate_rescue_plan`, presents an interactive approval card separating executable actions from manual interventions. Upon explicit button approval, sequentially executes approved actions, re-reads persisted records to verify persistence, recalculates live health, and renders a verification card with explicit truthfulness disclaimers.
1. **Workflow 1: Daily Priorities**
   - *Sample Utterance:* `"What should I work on today?"` or `"Daily priorities"`
   - *Execution:* Calls `get_priority_recommendations` + `list_blockers`. Correlates urgency, bugs, and deadlines, highlighting open blockers.
2. **Workflow 2: Project Investigation**
   - *Sample Utterance:* `"Inspect DevPulse Analytics"` or `"Check status of Mobile Checkout SDK"`
   - *Execution:* Resolves project ID, calls `get_project_details` + `get_project_health`, and presents health rating and active blockers.
3. **Workflow 3: Complete a Task**
   - *Sample Utterance:* `"Complete task task-cloudsync-1"` or `"Finish task 'Resolve memory spike'"`
   - *Execution:* Resolves target task (prompts user if ambiguous), calls `update_task_status`, and confirms completion **only after verifying** stored state.
4. **Workflow 4: Remaining Work**
   - *Sample Utterance:* `"Show remaining work"` or `"What's left to do?"`
   - *Execution:* Calls `list_tasks` + `list_projects`, groups open deliverables by project, and displays progress status.
5. **Workflow 5: Maintenance Review**
   - *Sample Utterance:* `"Review maintenance tasks"` or `"Any upcoming maintenance?"`
   - *Execution:* Calls `list_maintenance_tasks`, categorizing overdue items and upcoming renewals.

---

## 5. Quickstart & Installation

### Prerequisites
* **Node.js**: v20+ (developed and verified on Node.js v24.18.0)
* **npm**: v10+

### Setup & Launch
```bash
# Clone the repository
git clone https://github.com/example/projectpilot-ai.git
cd projectpilot-ai

# Install dependencies (@modelcontextprotocol/sdk, zod)
npm install

# Start the application server
npm start
```

Once started, the server outputs:
```
======================================================
 ProjectPilot AI - Operations Assistant for Developers 
======================================================
 Server running on http://localhost:3000
 MCP Streamable HTTP: http://localhost:3000/mcp
 Diagnostics:         http://localhost:3000/api/info
 Ready for hackathon evaluation.
```

Open **`http://localhost:3000`** in your browser.

---

## 6. Testing Instructions

Automated tests run using Node.js's built-in test runner (`node:test` and `node:assert`). All tests run against isolated temporary data stores to ensure zero contamination of user data.

```bash
npm test
```

### Verified Test Results (179 passing tests across 34 suites, 0 failures)
```
✔ Evidence-Based Project Intelligence & Truthful Health
✔ Model Context Protocol (MCP) Streamable HTTP Server
✔ MCP Tool: generate_rescue_plan (12th Tool Integration)
✔ Autonomous Project Rescue - Sequential Action Execution & Verification (Phase 4)
✔ Autonomous Project Rescue Planning Service (Phase 1)
✔ Autonomous Project Rescue - Conversational Workflow (Phase 3)
✔ ProjectPilot AI - Security & Hardening Audit Tests
✔ ProjectPilot Services
✔ ProjectStore CRUD & Persistence
✔ Assistant Conversational Workflows (Alexa+ Track Simulation)

Total: 179 tests passed across 34 suites (0 failures, 0 skipped)
```

---

## 7. MCP Protocol Testing via cURL

You can test the MCP Streamable HTTP endpoint directly from the command line:

### Step 1: Initialize Session
```bash
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": { "name": "terminal-test", "version": "1.0.0" }
    }
  }'
```
*Note the returned `mcp-session-id` header.*

### Step 2: List Discovered Tools
```bash
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: <SESSION_ID>" \
  -H "mcp-protocol-version: 2025-11-25" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

### Step 3: Invoke `get_priority_recommendations`
```bash
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: <SESSION_ID>" \
  -H "mcp-protocol-version: 2025-11-25" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_priority_recommendations",
      "arguments": { "limit": 3 }
    }
  }'
```

---

## 8. Limitations & Truthful Disclosures

In accordance with hackathon guidelines:
1. **Real Implementations**:
   - **MCP Streamable HTTP Transport**: Conforms to MCP specification `2025-11-25` over HTTP with stateful session management and SSE streaming.
   - **12 Registered MCP Tools**: Real, schema-validated MCP tools discovered via `tools/list`, including the signature `generate_rescue_plan`.
   - **Autonomous Project Rescue**: Real multi-step workflow (`Investigate → Diagnose → Plan → Approve → Execute → Verify`).
   - **Precondition & Freshness Verification**: Validates task status, project ID, and blocker text against current persisted data before executing each action (`_checkPreconditions`).
   - **Re-Read Write Verification**: Re-reads database records from disk after write execution to verify persistence before reporting success.
   - **Persistent Storage**: Atomic file persistence (`data/store.json`) using safe temp-file-and-rename patterns (`.tmp` + `rename`).
   - **Deterministic Health & Priority Logic**: Evidence-backed health ratings and transparent priority ranking derived strictly from persisted records.

2. **Truthful Disclosures & Intentional Architectural Boundaries**:
   - **Approval Authorization Gating**: The rescue plan approval step is gated client-side by the `AssistantOrchestrator` and `RescueExecutionEngine`. The MCP server enforces transport authentication (via `MCP_API_KEY` / Bearer token) and input parameter schema validation via Zod, but individual MCP write tools (`update_task_status`, `update_project`) execute independently over HTTP if transport authentication passes.
   - **Administrative Status Transitions vs. Physical Code Fixes**: Remediation actions update project management records (e.g. marking a task `in_progress` or unblocking a task). They do **not** repair underlying source code, modify repositories, or compile software. The system explicitly disclaims that administrative state changes require human engineering for physical code fixes.
   - **Blocker Field Clearing Semantics**: In `store.updateTaskStatus`, transitioning a task to `in_progress` or `todo` automatically sets `blocker = null` unless an explicit new blocker reason is provided.
   - **Concurrency Scope**: A client-side concurrency mutex (`isExecuting` flag) prevents rapid duplicate clicks within a single browser tab. It does not provide cross-tab or distributed multi-user concurrency locking.
   - **Alexa+ Interface**: This is a browser-based simulation of conversational Alexa+ interactions (incorporating Web Speech synthesis). It is **not** an official Amazon hardware integration and makes no claim to gated Alexa+ partner APIs.
   - **Intent Routing**: The conversational orchestrator uses deterministic intent routing that converts natural speech requests into concrete MCP tool calls. It is not an unconstrained generative LLM.
   - **External Service Monitoring**: The application does not probe external servers, cloud providers, or git remotes. Maintenance tasks represent developer-recorded schedules.

---

## 9. 3-Minute Video Demonstration Script

An 8-part demonstration walkthrough for hackathon judges showcasing the signature Autonomous Project Rescue capability:

* **[0:00 - 0:20] Step 1: Introduction & Mission (Alexa+ Track)**
  - *"Welcome to ProjectPilot AI, an operations assistant and developer dashboard built for the Build, Ship, Shape: Amazon Developer Hackathon 2026 targeting the Alexa+ Track."*
  - *"Software developers constantly juggle multiple projects, competing deadlines, and unforeseen blockers. ProjectPilot AI bridges developer operations with the Model Context Protocol over Streamable HTTP, featuring our signature capability: Autonomous Project Rescue."*
* **[0:20 - 0:45] Step 2: MCP Architecture & Live Protocol Inspector**
  - Click the **MCP Inspector** pill in the top header.
  - *"Notice the live MCP connection status. We negotiated protocol version `2025-11-25` over Streamable HTTP. All 12 core MCP tools are discovered and listed here with full Zod input schemas."*
  - Show the live JSON-RPC telemetry log streaming real-time request and response payloads.
* **[0:45 - 1:10] Step 3: Project Investigation & Honest Health Intelligence**
  - Switch to the Assistant tab and run: `"Inspect Mobile Checkout SDK"`.
  - *"The assistant invokes `get_project_details` and `get_project_health`. Notice our truthful health model: rather than reporting false optimism, it accurately rates the project as At Risk because of an active critical blocker: 'Upstream identity service rejects concurrent token refresh'."*
* **[1:10 - 1:35] Step 4: Autonomous Rescue Plan Generation (Signature Capability)**
  - Speak or type: `"Rescue project Mobile Checkout SDK"`.
  - *"The assistant initiates our signature rescue workflow by invoking the `generate_rescue_plan` MCP tool. It synthesizes an evidence-based plan, projecting the health impact and clearly separating executable database actions from manual engineering recommendations."*
* **[1:35 - 2:05] Step 5: Selective Approval & Safety Controls**
  - Point out the interactive approval card with checkboxes.
  - *"Safety is paramount. The assistant enforces an explicit approval gate—conversational affirmations cannot trigger writes. We can selectively approve actions or cancel the plan without any state changes. We'll approve the unblock action."*
  - Click **Approve Selected**.
* **[2:05 - 2:25] Step 6: Sequential Action Execution & Re-read Verification**
  - Watch the live progress state transition from `AWAITING_APPROVAL` to `EXECUTING` to `VERIFYING`.
  - *"The execution engine checks preconditions against live store data to prevent stale-state race conditions, calls `update_task_status`, and then directly re-reads disk storage to verify that the write actually persisted."*
* **[2:25 - 2:45] Step 7: Live Health Recalculation & Truthful Disclaimers**
  - Point to the completed Verification Card.
  - *"Post-execution, ProjectPilot recalculates live health from the fresh database state. Crucially, the assistant includes an honest disclosure: it reports that administrative status was transitioned, but explicitly warns that underlying code changes still require manual developer intervention."*
* **[2:45 - 3:00] Step 8: Persistence Verification & Closing**
  - Navigate to the Tasks tab to show the task status updated to `In Progress` with the blocker cleared. Refresh the browser to prove persistence across sessions.
  - *"With 179 passing automated tests across 34 suites, atomic JSON persistence, and full MCP specification compliance, ProjectPilot AI is safe, transparent, and ready for evaluation. Thank you!"*

---

## 10. Licence

Licensed under the [MIT License](LICENSE).
