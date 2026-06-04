require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const LOCAL_CHAIN_URL = process.env.LOCAL_CHAIN_URL || process.env.GANACHE_URL || "http://127.0.0.1:8545";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

module.exports = {
  solidity: "0.8.19",
  networks: {
    local: {
      url: LOCAL_CHAIN_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
