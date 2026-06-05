require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { ethers } = require('ethers');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;
const EXAM_FEE_ETH = process.env.EXAM_FEE_ETH || '0.01';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const sessions = {};
const registrations = {};

const EXAM_LOGGER_ABI = [
  'function storeLog(string batchId, string cid, string sha256Hash, string studentId, string examId, uint256 cheatScore, uint256 marksObtained, uint256 totalMarks) public',
  'function getLog(string batchId) public view returns (tuple(string cid, string sha256Hash, string studentId, string examId, uint256 timestamp, uint256 cheatScore, uint256 marksObtained, uint256 totalMarks))',
];

function localChainUrl() {
  return process.env.GANACHE_URL || process.env.LOCAL_CHAIN_URL;
}

function ownerAddress() {
  if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.PRIVATE_KEY || '')) return '';
  return new ethers.Wallet(process.env.PRIVATE_KEY).address;
}

function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function cheatingScore(events) {
  let score = 0;
  for (const e of events) {
    if (e.eventType === 'tab_switch') score += 2;
    else if (e.eventType === 'copy') score += 5;
    else if (e.eventType === 'paste') score += 5;
    else if (e.eventType === 'idle') score += 3;
    else if (e.eventType === 'right_click') score += 1;
    else if (e.eventType === 'cut') score += 4;
  }
  return score;
}

async function uploadToIPFS(jsonObject, filename) {
  const pinataApiKey = process.env.PINATA_API_KEY;
  const pinataSecretKey = process.env.PINATA_SECRET_KEY;

  if (!pinataApiKey || !pinataSecretKey || pinataApiKey === 'your_pinata_api_key') {
    throw new Error('Pinata API keys are missing. Add PINATA_API_KEY and PINATA_SECRET_KEY to backend/.env');
  }

  const jsonBuffer = Buffer.from(JSON.stringify(jsonObject, null, 2));
  const form = new FormData();
  form.append('file', jsonBuffer, { filename, contentType: 'application/json' });
  form.append('pinataMetadata', JSON.stringify({ name: filename }));

  const response = await axios.post(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    form,
    {
      maxBodyLength: Infinity,
      headers: {
        ...form.getHeaders(),
        pinata_api_key: pinataApiKey,
        pinata_secret_api_key: pinataSecretKey,
      },
      timeout: 15000,
    }
  );

  const cid = response.data.IpfsHash;
  console.log(`[Pinata] Uploaded: ${cid}`);
  return { cid, source: 'pinata' };
}

async function storeLogOnChain(batchId, cid, sha256Hash, studentId, examId, cheatScore, examMarks) {
  const rpcUrl = localChainUrl();
  const privateKey = process.env.PRIVATE_KEY;
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!rpcUrl || !/^0x[0-9a-fA-F]{64}$/.test(privateKey || '') || !contractAddress) {
    return {
      stored: false,
      reason: 'Blockchain env not configured. Set GANACHE_URL, PRIVATE_KEY, and CONTRACT_ADDRESS.',
    };
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, EXAM_LOGGER_ABI, wallet);
  const marksObtained = examMarks?.obtained || 0;
  const totalMarks = examMarks?.total || 0;

  const tx = await contract.storeLog(
    batchId,
    cid,
    sha256Hash,
    studentId,
    examId,
    cheatScore,
    marksObtained,
    totalMarks
  );
  const receipt = await tx.wait();

  console.log(`[Blockchain] Stored batch ${batchId} in tx ${receipt.hash}`);
  return {
    stored: true,
    txHash: receipt.hash,
    contractAddress,
  };
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: Object.keys(sessions).length });
});

app.get('/config', (req, res) => {
  res.json({
    contractAddress: process.env.CONTRACT_ADDRESS || '',
    localChainUrl: localChainUrl() || '',
    ownerAddress: ownerAddress(),
    examFeeEth: EXAM_FEE_ETH,
  });
});

app.get('/chain-accounts', async (req, res) => {
  try {
    const rpcUrl = localChainUrl();
    if (!rpcUrl) return res.status(500).json({ error: 'GANACHE_URL is not configured' });

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const accounts = await provider.listAccounts();
    const owner = ownerAddress().toLowerCase();

    res.json({
      ownerAddress: ownerAddress(),
      examFeeEth: EXAM_FEE_ETH,
      accounts: accounts
        .map((account) => account.address)
        .filter((address) => address.toLowerCase() !== owner),
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load local blockchain accounts', details: err.message });
  }
});

app.post('/register-student', async (req, res) => {
  const { studentId, examId, studentAddress } = req.body;
  if (!studentId || !examId || !studentAddress) {
    return res.status(400).json({ error: 'studentId, examId, and studentAddress are required' });
  }

  const key = `${studentId}:${examId}`;
  if (registrations[key]) return res.json({ success: true, alreadyRegistered: true, registration: registrations[key] });

  try {
    const rpcUrl = localChainUrl();
    if (!rpcUrl) return res.status(500).json({ error: 'GANACHE_URL is not configured' });

    const owner = ownerAddress();
    if (!owner) return res.status(500).json({ error: 'Owner private key is not configured' });

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = await provider.getSigner(studentAddress);
    const tx = await signer.sendTransaction({
      to: owner,
      value: ethers.parseEther(EXAM_FEE_ETH),
    });
    const receipt = await tx.wait();

    const registration = {
      studentId,
      examId,
      studentAddress,
      ownerAddress: owner,
      examFeeEth: EXAM_FEE_ETH,
      txHash: receipt.hash,
      registeredAt: new Date().toISOString(),
    };

    registrations[key] = registration;
    res.json({ success: true, registration });
  } catch (err) {
    res.status(500).json({ error: 'Registration payment failed', details: err.message });
  }
});

app.get('/ipfs-status', (req, res) => {
  const pinataApiKey = process.env.PINATA_API_KEY;
  const pinataSecretKey = process.env.PINATA_SECRET_KEY;
  const available = Boolean(pinataApiKey && pinataSecretKey && pinataApiKey !== 'your_pinata_api_key');

  res.json({
    available,
    source: available ? 'pinata' : 'none',
  });
});

app.post('/start-session', (req, res) => {
  const { studentId, examId } = req.body;
  if (!studentId || !examId) {
    return res.status(400).json({ error: 'studentId and examId are required' });
  }

  const registration = registrations[`${studentId}:${examId}`];
  if (!registration) {
    return res.status(403).json({ error: 'Student must register and pay before starting the exam' });
  }

  const sessionId = uuidv4();
  sessions[sessionId] = {
    studentId,
    examId,
    registration,
    events: [],
    createdAt: new Date().toISOString(),
  };

  console.log(`[Session] Started: ${sessionId} for student ${studentId}`);
  res.json({ sessionId, message: 'Session started' });
});

app.post('/log-event', (req, res) => {
  const { sessionId, studentId, examId, eventType, timestamp, metadata } = req.body;
  if (!sessionId || !eventType) {
    return res.status(400).json({ error: 'sessionId and eventType are required' });
  }

  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      studentId: studentId || 'unknown',
      examId: examId || 'unknown',
      events: [],
      createdAt: new Date().toISOString(),
    };
  }

  const event = {
    id: uuidv4(),
    studentId: studentId || sessions[sessionId].studentId,
    examId: examId || sessions[sessionId].examId,
    eventType,
    timestamp: timestamp || new Date().toISOString(),
    metadata: metadata || {},
  };

  sessions[sessionId].events.push(event);
  console.log(`[Event] ${sessionId} -> ${eventType}`);
  res.json({ success: true, eventId: event.id, totalEvents: sessions[sessionId].events.length });
});

app.get('/session-events/:sessionId', (req, res) => {
  const session = sessions[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    ...session,
    eventCount: session.events.length,
    cheatScore: cheatingScore(session.events),
  });
});

app.post('/finalize-log', async (req, res) => {
  const { sessionId, answers, examMarks } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const session = sessions[sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.events.length) return res.status(400).json({ error: 'No events to finalize' });

  try {
    const batchId = uuidv4();
    const finalizedAt = new Date().toISOString();
    const score = cheatingScore(session.events);

    const logBatch = {
      batchId,
      sessionId,
      studentId: session.studentId,
      examId: session.examId,
      createdAt: session.createdAt,
      finalizedAt,
      eventCount: session.events.length,
      cheatScore: score,
      examMarks: examMarks || null,
      answers: answers || {},
      events: session.events,
    };

    const hash = sha256(logBatch);
    logBatch.integrity = { sha256: hash, algorithm: 'sha256' };

    const filename = `exam-log-${session.studentId}-${session.examId}-${batchId}.json`;
    const { cid, source } = await uploadToIPFS(logBatch, filename);
    const blockchain = await storeLogOnChain(
      batchId,
      cid,
      hash,
      session.studentId,
      session.examId,
      score,
      logBatch.examMarks
    );

    console.log(`[Finalize] BatchId: ${batchId} | CID: ${cid} | Hash: ${hash}`);
    delete sessions[sessionId];

    res.json({
      success: true,
      batchId,
      cid,
      sha256Hash: hash,
      studentId: session.studentId,
      examId: session.examId,
      eventCount: logBatch.eventCount,
      cheatScore: score,
      examMarks: logBatch.examMarks,
      filename,
      source,
      ipfsUrl: `https://gateway.pinata.cloud/ipfs/${cid}`,
      blockchain,
      txHash: blockchain.txHash || null,
      contractAddress: blockchain.contractAddress || null,
    });
  } catch (err) {
    console.error('[Finalize Error]', err.message);
    res.status(500).json({
      error: 'Failed to finalize log',
      details: err.message,
      hint: 'Add valid Pinata keys to backend/.env. For blockchain storage, also start Ganache Desktop and set CONTRACT_ADDRESS and PRIVATE_KEY.',
    });
  }
});

app.post('/verify', async (req, res) => {
  const { cid, originalHash } = req.body;
  if (!cid || !originalHash) {
    return res.status(400).json({ error: 'cid and originalHash are required' });
  }

  try {
    const gateways = [
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
    ];

    let fetchedData = null;
    for (const url of gateways) {
      try {
        const response = await axios.get(url, { timeout: 10000 });
        fetchedData = response.data;
        break;
      } catch (_) {}
    }

    if (!fetchedData) {
      return res.status(500).json({
        error: 'Could not fetch file from IPFS',
        hint: 'Check the CID and make sure the file is pinned in Pinata.',
      });
    }

    const dataForHash = { ...fetchedData };
    delete dataForHash.integrity;
    const recomputedHash = sha256(dataForHash);
    const valid = recomputedHash === originalHash;

    res.json({
      valid,
      recomputedHash,
      originalHash,
      status: valid ? 'VALID - Data is untampered' : 'TAMPERED - Hash mismatch',
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Verify Error]', err.message);
    res.status(500).json({ error: 'Verification failed', details: err.message });
  }
});

app.get('/all-sessions', (req, res) => {
  const summary = Object.entries(sessions).map(([id, s]) => ({
    sessionId: id,
    studentId: s.studentId,
    examId: s.examId,
    eventCount: s.events.length,
    cheatScore: cheatingScore(s.events),
    createdAt: s.createdAt,
  }));
  res.json(summary);
});

app.listen(PORT, () => {
  const hasPinataKeys = Boolean(
    process.env.PINATA_API_KEY &&
    process.env.PINATA_SECRET_KEY &&
    process.env.PINATA_API_KEY !== 'your_pinata_api_key'
  );

  console.log(`\nExam Logger Backend running on http://localhost:${PORT}`);
  console.log(`Health:      http://localhost:${PORT}/health`);
  console.log(`IPFS Status: http://localhost:${PORT}/ipfs-status`);
  console.log(`\nIPFS: Pinata mode (${hasPinataKeys ? 'keys loaded' : 'missing keys'})\n`);
});
