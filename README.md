# ProjectPilot AI

> **Your projects. Your priorities. One intelligent assistant.**

Developed for the **Build, Ship, Shape: Amazon Developer Hackathon 2026** — *Alexa+ Track*.

---

## 1. Executive Overview

**ProjectPilot AI** is a polished, operations assistant and developer dashboard built for software engineers managing multiple software projects, unfinished tasks, critical blockers, and technical maintenance.

Unlike conventional dashboards that use ad-hoc internal APIs, ProjectPilot AI is powered by the **Model Context Protocol (MCP)** using the official **Streamable HTTP** transport (`specification 2025-11-25`). Every project query, priority recommendation, status transition, and conversational workflow executes through verified, deterministic MCP tool calls over HTTP.

### Product Highlights
* **Alexa+ Developer Operations Simulation**: Natural-language operational commands (daily priorities, project investigations, task completions, remaining work, maintenance tracking) mapped directly to MCP tool executions.
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
│  • 11 Executable Tools with Zod Schema Validation              │
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

## 3. Mandatory MCP Tools (11 Tools)

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

---

## 4. Conversational Workflows (Alexa+ Track)

The assistant orchestrates multi-step MCP tool calls and presents clean natural language summaries:

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

### Verified Test Results (32 passing, 0 failures)
```
✔ Model Context Protocol (MCP) Streamable HTTP Server (17 tests)
  ✔ Step 1: MCP Handshake & Protocol Version Negotiation (2025-11-25)
  ✔ Step 2: MCP notifications/initialized notification (HTTP 202)
  ✔ Step 3: Tool Discovery (tools/list) exposes all 11 mandatory tools
  ✔ Tool 1: list_projects
  ✔ Tool 2: get_project_details
  ✔ Tool 3: create_project
  ✔ Tool 4: update_project
  ✔ Tool 5: list_tasks
  ✔ Tool 6: create_task
  ✔ Tool 7: update_task_status
  ✔ Tool 8: list_blockers
  ✔ Tool 9: get_project_health
  ✔ Tool 10: get_priority_recommendations
  ✔ Tool 11: list_maintenance_tasks
  ✔ Error handling: tool error on invalid project query
  ✔ Error handling: request with invalid session returns 404
  ✔ Session Termination: HTTP DELETE /mcp cleans up session
✔ ProjectPilot Services (3 tests)
  ✔ HealthService calculates truthful health metrics and status
  ✔ PriorityService transparently ranks tasks and provides explicit reasons
  ✔ MaintenanceService groups overdue and upcoming maintenance tasks
✔ ProjectStore CRUD & Persistence (5 tests)
  ✔ initializes with sample data when file does not exist
  ✔ Project CRUD operations work with validation
  ✔ rejects invalid project input
  ✔ Task CRUD operations and reference integrity
  ✔ persistence across restart: new instance retains changes without overwriting
✔ Assistant Conversational Workflows (Alexa+ Track Simulation) (7 tests)
  ✔ Workflow 1: Daily priorities
  ✔ Workflow 2: Project investigation
  ✔ Workflow 3: Complete a task
  ✔ Workflow 4: Remaining work
  ✔ Workflow 5: Maintenance review
  ✔ Ambiguity resolution: prompts user when multiple tasks match
  ✔ Honest fallback for unsupported or out-of-scope requests

Total: 32 tests passed (0 failures)
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
   - MCP Server and Client using Streamable HTTP transport and MCP specification `2025-11-25`.
   - Real JSON storage with safe atomic writes (`.tmp` + rename).
   - Real CRUD for projects and tasks with validation and referential integrity.
   - Real priority ranking algorithm based on explicit priority, due dates, bugs, and blockers.
   - Real health calculations derived strictly from persisted records.
2. **Simulations & Intentional Boundaries**:
   - **Alexa+ Interface**: This is a browser-based simulation of conversational Alexa+ interactions (incorporating Web Speech synthesis). It is **not** an official Amazon hardware integration and makes no claim to gated Alexa+ partner APIs.
   - **Intent Routing**: The conversational orchestrator uses a deterministic intent router that converts natural speech requests into concrete MCP tool calls. It is not an unconstrained generative LLM.
   - **External Service Monitoring**: The application does not probe external servers, cloud providers, or domain registrars. Maintenance tasks represent developer-recorded schedules.

---

## 9. 3-Minute Video Demonstration Script

* **[0:00 - 0:30] Introduction & Mission**
  - "Hello! This is ProjectPilot AI, an operations assistant and developer dashboard created for the Build, Ship, Shape: Amazon Developer Hackathon 2026, targeting the Alexa+ track."
  - "Software developers constantly balance multiple projects, unfinished tasks, and sudden blockers. ProjectPilot AI bridges these operations with the Model Context Protocol over Streamable HTTP."
* **[0:30 - 1:15] MCP Architecture & Live Protocol Inspector**
  - Click on the **MCP Inspector** pill in the top header.
  - "Notice the live MCP connection status. We negotiated protocol version `2025-11-25` over Streamable HTTP. All 11 required MCP tools are discovered and listed here with their input schemas."
  - Show the live telemetry log updating in real time with JSON-RPC requests and responses.
* **[1:15 - 2:00] Daily Priorities & Project Investigation Workflows**
  - In the Assistant tab, click **Daily priorities** (`"What should I work on today?"`).
  - Show the tool call `get_priority_recommendations` and `list_blockers` in the chat tracer.
  - Explain the transparent scoring: Critical priority (+40 pts), bug urgency (+15 pts), and active blockers.
  - Run `"Investigate Mobile Checkout SDK"`. The assistant invokes `get_project_details` and surfaces the active authentication blocker.
* **[2:00 - 2:40] Task Completion & State Verification**
  - Run `"Complete task 'Resolve memory spike'"`.
  - Show the assistant calling `update_task_status` and explicitly verifying the stored state before confirming completion.
  - Switch to the Tasks tab: show that the task status is now DONE and the progress bar has updated.
* **[2:40 - 3:00] Maintenance Review & Conclusion**
  - Run `"Review maintenance tasks"`.
  - Show the overdue PostgreSQL vacuum task and upcoming SSL certificate rotation.
  - "With 32 passing automated tests, atomic JSON persistence, and 100% compliant MCP Streamable HTTP transport, ProjectPilot AI is testable, reliable, and submission-ready. Thank you!"

---

## 10. Licence

Licensed under the [MIT License](LICENSE).
