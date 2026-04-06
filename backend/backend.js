const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

const uploadToIPFS = async () => {
    const data = new FormData();
    data.append("file", fs.createReadStream("log.json"));

    const res = await axios.post(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        data,
        {
            headers: {
                ...data.getHeaders(),
                pinata_api_key: "YOUR_API_KEY",
                pinata_secret_api_key: "YOUR_SECRET_KEY",
            },
        }
    );

    console.log("CID:", res.data.IpfsHash);
};

uploadToIPFS();