// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract ExamLogger {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    struct LogBatch {
        string cid;
        uint256 timestamp;
        uint256 cheatScore;
    }

    mapping(bytes32 => LogBatch) private batches;

    event LogStored(
        bytes32 indexed batchId,
        string cid,
        uint256 cheatScore
    );

    function storeLog(
        string memory batchId,
        string memory cid,
        uint256 cheatScore
    ) public onlyOwner {
        bytes32 key = keccak256(bytes(batchId));
        require(bytes(batches[key].cid).length == 0, "Exists");

        batches[key] = LogBatch(
            cid,
            block.timestamp,
            cheatScore
        );

        emit LogStored(key, cid, cheatScore);
    }

    function getLog(string memory batchId)
        public
        view
        returns (LogBatch memory)
    {
        return batches[keccak256(bytes(batchId))];
    }
}
