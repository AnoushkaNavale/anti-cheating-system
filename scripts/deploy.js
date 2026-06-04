const hre = require("hardhat");

async function main() {
  const ExamLogger = await hre.ethers.getContractFactory("ExamLogger");
  const examLogger = await ExamLogger.deploy();
  await examLogger.waitForDeployment();

  const address = await examLogger.getAddress();
  console.log(`ExamLogger deployed to: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
