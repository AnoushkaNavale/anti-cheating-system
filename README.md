# ExamChain — Tamper-Proof Exam Attempt Logger

A decentralized application (dApp) that captures student behavior during online exams,
stores logs on IPFS, and records proof-of-integrity hashes on the Ethereum blockchain via Ganache.

---

## 🏗 Project Structure

```
exam-logger/
├── contracts/
│   └── ExamLogger.sol          # Solidity smart contract
├── backend/
│   ├── server.js               # Express API
│   ├── package.json
│   └── .env.example
├── frontend/
│   └── index.html              # Full frontend (single file)
└── README.md
```

---

## ⚙️ Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| Node.js | ≥ 18 | https://nodejs.org |
| Ganache | Latest | https://trufflesuite.com/ganache |
| MetaMask | Latest | Browser extension |
| Remix IDE | Web | https://remix.ethereum.org |
| Pinata Account | Free | https://app.pinata.cloud |

---

## 🚀 Quick Start

### Step 1 — Launch Ganache

1. Open Ganache → click **Quickstart (Ethereum)**
2. Note down the **RPC Server**: `http://127.0.0.1:7545`
3. Note down **Network ID**: `1337`
4. Copy any account's **private key** (click the key icon)

---

### Step 2 — Configure MetaMask

1. Open MetaMask → Settings → Networks → **Add Network Manually**

```
Network Name:  Ganache Local
RPC URL:       http://127.0.0.1:7545
Chain ID:      1337
Currency:      ETH
```

2. Import account: MetaMask → Import Account → Paste Ganache private key
3. You should see ~100 ETH test balance

---

### Step 3 — Deploy Smart Contract via Remix IDE

1. Open https://remix.ethereum.org
2. Create new file: `ExamLogger.sol`
3. Paste the entire contents of `contracts/ExamLogger.sol`
4. Go to **Solidity Compiler** tab:
   - Compiler: `0.8.19`
   - Click **Compile ExamLogger.sol**
5. Go to **Deploy & Run Transactions** tab:
   - Environment: **Injected Provider - MetaMask**
   - MetaMask will prompt to connect → **Confirm**
   - Ensure you're on Ganache Local network
   - Click **Deploy** → Confirm MetaMask transaction
6. Copy the **deployed contract address** (shown in Remix under "Deployed Contracts")

---

### Step 4 — Configure Backend

```bash
cd backend/

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

Edit `.env`:
```env
PORT=3001
PINATA_API_KEY=your_actual_key
PINATA_SECRET_KEY=your_actual_secret
IPFS_PROVIDER=pinata
```

**Getting Pinata Keys:**
1. Go to https://app.pinata.cloud → Sign up (free)
2. API Keys → New Key → Admin → Create Key
3. Copy API Key and Secret

```bash
# Start backend
npm start
# → Server running at http://localhost:3001
```

---

### Step 5 — Open Frontend

Simply open `frontend/index.html` in your browser (double-click or use a local server):

```bash
# Option A: Direct open
open frontend/index.html

# Option B: Simple HTTP server
cd frontend && npx serve .
# → http://localhost:3000
```

---

### Step 6 — Complete Setup in UI

1. Go to **SETUP** tab in the app
2. Paste your deployed contract address
3. Set API URL to `http://localhost:3001`
4. Click **CONNECT WALLET** (top right) → approve MetaMask

---

## 📋 Test Flow

### Basic Exam Test

1. **Start Session**
   - Set Student ID: `STU-001`
   - Set Exam ID: `EXAM-CS101`
   - Click **▶ START EXAM**

2. **Trigger Events**
   - Switch browser tabs → comes back → tab_switch logged
   - Press Ctrl+C → copy event logged
   - Right-click on page → right_click logged
   - Wait 30 seconds idle → idle event logged
   - Watch the live event feed update in real-time

3. **Finalize**
   - Click **⬡ FINALIZE & STORE**
   - Backend batches events → uploads to IPFS → returns CID
   - MetaMask popup → **Confirm** transaction
   - CID and TX hash displayed

4. **Verify Integrity**
   - Go to **VERIFY** tab (auto-filled)
   - Click **🔍 VERIFY INTEGRITY**
   - Should show ✅ VALID
   - To test tamper detection: change 1 character in the hash → shows 🚨 TAMPERED

5. **Admin Dashboard**
   - Go to **ADMIN** tab
   - See all active sessions, event counts, risk scores

---

## 🔌 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/start-session` | Create exam session |
| POST | `/log-event` | Log single event |
| GET | `/session-events/:id` | Get session events |
| POST | `/finalize-log` | Batch, hash, upload to IPFS |
| POST | `/verify` | Verify CID integrity |
| GET | `/all-sessions` | Admin: list sessions |

### POST /log-event
```json
{
  "sessionId": "uuid",
  "studentId": "STU-001",
  "examId": "EXAM-CS101",
  "eventType": "tab_switch",
  "timestamp": "2024-01-01T10:00:00.000Z",
  "metadata": { "detail": "Student switched tabs" }
}
```

### POST /finalize-log → Response
```json
{
  "success": true,
  "batchId": "uuid",
  "cid": "QmXxx...",
  "sha256Hash": "abc123...",
  "eventCount": 12,
  "cheatScore": 17,
  "ipfsUrl": "https://gateway.pinata.cloud/ipfs/QmXxx..."
}
```

---

## 🔐 Smart Contract Functions

```solidity
// Store a log batch CID on-chain
function storeLog(
    string memory batchId,
    string memory cid,
    string memory sha256Hash,
    string memory studentId,
    string memory examId,
    uint256 eventCount,
    uint256 cheatScore
) public

// Retrieve a stored log
function getLog(string memory batchId) public view returns (...)

// Get all batch IDs for a student
function getStudentBatches(string memory studentId) public view returns (string[] memory)
```

---

## 🎯 Cheating Score System

| Event | Points | Severity |
|-------|--------|----------|
| Tab switch | +2 | Medium |
| Copy/Paste | +5 | High |
| Cut | +4 | High |
| Idle (30s) | +3 | Medium |
| Right click | +1 | Low |

**Thresholds:**
- 0–9: 🟢 Low Risk
- 10–19: 🟡 Medium Risk
- 20+: 🔴 High Risk (Flagged)

---

## 🧩 Architecture

```
┌─────────────────────────────────────────────────────┐
│                   STUDENT BROWSER                    │
│  ┌──────────────────────────────────────────────┐   │
│  │  index.html                                  │   │
│  │  • Exam UI + Event Capture                   │   │
│  │  • Ethers.js → MetaMask                      │   │
│  └──────────────┬───────────────────────────────┘   │
└─────────────────│───────────────────────────────────┘
                  │ POST /log-event
                  │ POST /finalize-log
                  ▼
┌─────────────────────────────────────────────────────┐
│                  NODE.JS BACKEND                     │
│  • Collects events in memory                        │
│  • Batches → JSON file                              │
│  • SHA-256 hash                                     │
│  • Upload to IPFS (Pinata)                          │
│  • Returns CID + Hash                               │
└─────────────────┬───────────────────────────────────┘
                  │
          ┌───────┴───────┐
          ▼               ▼
┌─────────────────┐  ┌──────────────────┐
│   IPFS/Pinata   │  │  Ethers.js call  │
│  Stores JSON    │  │  storeLog(cid)   │
│  Returns CID    │  └────────┬─────────┘
└─────────────────┘           │ MetaMask signs
                              ▼
                    ┌──────────────────┐
                    │   GANACHE/EVM    │
                    │ ExamLogger.sol   │
                    │ stores: CID,     │
                    │ hash, timestamp  │
                    └──────────────────┘
```

---

## 🛠 Troubleshooting

**MetaMask shows wrong network:**
→ Switch to Ganache Local (Chain ID: 1337)

**"Contract not found":**
→ Re-deploy to Ganache, paste new address in Setup tab

**IPFS upload fails:**
→ Check Pinata API keys in `.env` — app runs in demo mode without them

**Backend CORS error:**
→ Ensure backend is running on port 3001; check `api-url` in sidebar

**Ganache restarted — contract gone:**
→ Ganache resets on restart; redeploy the contract via Remix
