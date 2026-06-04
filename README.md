# ExamChain — Tamper-Proof Exam Attempt Logger

A decentralized application (dApp) that captures student behavior during online exams and stores logs in a tamper-proof manner using blockchain and IPFS. No MetaMask or wallet connection required to run the application.

---

## Project Structure

```
anti-cheating-system/
├── frontend/
│   ├── index.html        # Main UI — all pages and structure
│   ├── style.css         # All styling and design system
│   └── app.js            # All JavaScript logic
├── backend/
│   ├── server.js         # Express API server
│   ├── package.json      # Node.js dependencies
│   └── .env.example      # Environment variables template
├── contracts/
│   └── ExamLogger.sol    # Solidity smart contract
└── README.md
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contract | Solidity 0.8.19 + Hardhat |
| Blockchain (local) | Hardhat local node |
| Backend | Node.js + Express |
| Frontend | HTML, CSS, Vanilla JavaScript |
| Storage | IPFS via Pinata |
| Record Keeping | localStorage (browser) |

> MetaMask, Ganache Desktop, and IPFS Desktop are NOT required to run this application.

---

## Features

- Real-time student behavior monitoring during exams
- Tracks tab switching, copy/paste, cut, right-click, and idle time
- Live event feed with timestamps
- Risk score calculation per student session
- Batch event logs, hash with SHA-256, upload to IPFS
- Store proof on blockchain via smart contract
- Verify data integrity — detect tampering
- Admin dashboard with session overview and cheating scores
- Works fully offline in demo/local mode if backend is unavailable

---

## Prerequisites

| Tool | Purpose | Download |
|------|---------|----------|
| Node.js (v18+) | Run backend server | https://nodejs.org |
| VS Code | Code editor | https://code.visualstudio.com |
| Pinata Account (optional) | IPFS uploads | https://app.pinata.cloud |

---

## Quick Start

### Step 1 — Start the Hardhat Local Blockchain

Open a VS Code terminal in the project root and run:

```bash
npm install
npm run chain
```

Keep this terminal open. Hardhat will print local test accounts and private keys.

### Step 2 — Deploy the Smart Contract

Open a second VS Code terminal in the project root.

Create `.env` from `.env.example` and paste one Hardhat private key:

```bash
cp .env.example .env
```

Then deploy:

```bash
npm run compile
npm run deploy:local
```

Copy the deployed contract address printed in the terminal.

---

### Step 3 — Configure Backend Environment

```bash
cd backend
cp .env.example .env
```

Edit `.env` and add your Pinata API keys:
```
PINATA_API_KEY=your_key_here
PINATA_SECRET_KEY=your_secret_here
LOCAL_CHAIN_URL=http://127.0.0.1:8545
CONTRACT_ADDRESS=your_deployed_contract_address
PRIVATE_KEY=your_hardhat_private_key
```

> Pinata keys are required for real IPFS uploads. The blockchain fields let the backend store the CID on the Hardhat local chain.

---

### Step 4 — Start the Backend Server

Open VS Code terminal and run:

```bash
cd anti-cheating-system/backend
npm install
npm start
```

You should see:
```
 Exam Logger Backend running on http://localhost:3001
   Health: http://localhost:3001/health
```

Keep this terminal running. Do not close it.

---

### Step 5 — Open the Frontend

Open **File Explorer** on your computer → navigate to:
```
anti-cheating-system/frontend/
```

Double-click **index.html** to open it in your browser.

> The app works directly from the file system. No Live Server needed since MetaMask is not required.

---

### Step 6 — Configure the App

1. Click the **SETUP** tab in the app
2. Paste your contract address in the **CONTRACT ADDRESS** field
3. Verify the API URL shows `http://localhost:3001`
4. Check the bottom-left sidebar — it should show **● Connected**

---

### Step 7 — Run an Exam

1. Click the **EXAM** tab
2. Enter Student ID (e.g. `STU-001`) and Exam ID (e.g. `EXAM-CS101`)
3. Click **▶ START EXAM**
4. Trigger events to test monitoring:
   - Switch to another browser tab and return → **Tab Switch logged**
   - Press `Ctrl+C` → **Copy logged**
   - Right-click on the page → **Right Click logged**
   - Wait 30 seconds without moving → **Idle logged**
5. Watch the live event feed update in real time
6. Click **⬡ FINALIZE & STORE** when done

---

### Step 8 — Verify Integrity

1. Click the **VERIFY** tab (it auto-fills after finalize)
2. Click ** VERIFY INTEGRITY**
3. Result shows ** VALID** if data is untampered
4. If hash is modified manually, it shows ** TAMPERED**

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |
| POST | `/start-session` | Create a new exam session |
| POST | `/log-event` | Log a single student event |
| GET | `/session-events/:id` | Get all events for a session |
| POST | `/finalize-log` | Batch, hash, upload to IPFS |
| POST | `/verify` | Verify CID integrity |
| GET | `/all-sessions` | List all active sessions |

### Example — POST /log-event

Request body:
```json
{
  "sessionId": "uuid-here",
  "studentId": "STU-001",
  "examId": "EXAM-CS101",
  "eventType": "tab_switch",
  "timestamp": "2026-04-06T10:00:00.000Z",
  "metadata": { "detail": "Student switched tabs" }
}
```

### Example — POST /finalize-log Response

```json
{
  "success": true,
  "batchId": "uuid",
  "cid": "QmXxx...",
  "sha256Hash": "abc123...",
  "eventCount": 15,
  "cheatScore": 23,
  "ipfsUrl": "https://gateway.pinata.cloud/ipfs/QmXxx..."
}
```

---

## Smart Contract Functions

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

// Retrieve a stored log by batch ID
function getLog(string memory batchId) public view returns (...)

// Get all batch IDs for a student
function getStudentBatches(string memory studentId) public view returns (string[] memory)

// Get total number of stored batches
function getTotalBatches() public view returns (uint256)
```

---

## Cheating Score System

| Event Type | Points | Severity |
|-----------|--------|----------|
| Tab Switch | +2 | Medium |
| Copy | +5 | High |
| Paste | +5 | High |
| Cut | +4 | High |
| Idle (30s) | +3 | Medium |
| Right Click | +1 | Low |

**Risk Levels:**
- 0 to 9 → 🟢 Low Risk
- 10 to 19 → 🟡 Medium Risk
- 20+ → 🔴 High Risk (Flagged)

---

## How Tamper Detection Works

```
Student exam ends
        ↓
Events batched into JSON file
        ↓
SHA-256 hash computed → stored as fingerprint
        ↓
JSON file uploaded to IPFS → CID received
        ↓
CID + hash stored in blockchain record
        ↓
        ─────── Later, for verification ───────
        ↓
Fetch file from IPFS using CID
        ↓
Recompute SHA-256 hash of fetched file
        ↓
Compare with stored hash
        ↓
Match →  VALID       No match →  TAMPERED
```

---

## Offline / Demo Mode

If the backend server is not running or Pinata keys are not configured, the app automatically runs in demo mode:

- Events are stored locally in the browser
- A mock IPFS CID is generated
- Blockchain records are saved in browser localStorage
- All features including verify and admin dashboard continue to work
- The sidebar shows **○ Backend offline (local mode)**

---

## Troubleshooting

**Backend not starting:**
```bash
# Make sure you are in the correct folder
cd anti-cheating-system/backend
npm install
npm start
```

**App shows "Backend offline":**
- Check the backend terminal is still running
- Check the API URL in the app matches `http://localhost:3001`
- Try opening `http://localhost:3001/health` in the browser — it should return `{"status":"ok"}`

**Contract address not saving:**
- Paste the address in the SETUP tab and it saves automatically to browser localStorage
- It will be remembered next time you open the app

**Events not logging:**
- Make sure you clicked **▶ START EXAM** first
- The session status should show **● RECORDING** in green

**IPFS upload failing:**
- Check your Pinata API keys in the `.env` file
- App automatically falls back to demo mode if keys are missing or invalid

---

## File Descriptions

| File | Purpose |
|------|---------|
| `frontend/index.html` | Complete HTML structure — all 4 tabs (Exam, Verify, Admin, Setup) |
| `frontend/style.css` | All CSS — design system, layout, components, animations |
| `frontend/app.js` | All JavaScript — state, event monitoring, API calls, blockchain records |
| `backend/server.js` | Express server — 7 API endpoints, IPFS upload, SHA-256 hashing |
| `backend/package.json` | Node.js project config and dependencies |
| `contracts/ExamLogger.sol` | Solidity smart contract — compiled and deployed with Hardhat |

---

## Changes From Previous Version

- Removed MetaMask wallet connection requirement completely
- Removed Ethers.js library dependency
- Removed Ganache Desktop requirement; Hardhat local node can run from VS Code
- Replaced wallet status with a clean **BLOCKCHAIN READY** indicator
- Blockchain records now stored in browser localStorage automatically
- Admin dashboard now shows both live sessions and past finalized records
- App works fully by opening index.html directly — no Live Server needed
- All features remain functional including verify, admin, and event monitoring

---

## Contract Address Used in This Project

```
0xf8e81D47203A594245E36C48e151709F0C19fBe8
```

Deployed on Remix VM (Osaka) — local test environment.

---

## Future Enhancements

- Deploy contract on Sepolia or Polygon testnet for public access
- Add facial recognition for continuous student identity verification
- Integrate with learning management systems like Moodle or Google Classroom
- Add screen recording and screenshot capture
- Machine learning based anomaly detection for cheating patterns
- Teacher dashboard with downloadable tamper-proof PDF reports
- Mobile app for invigilators to monitor exams in real time
