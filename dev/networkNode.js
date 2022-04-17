const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const Blockchain = require('./blockchain');
const { v1: uuid } = require('uuid');
const port = process.argv[2];
const rp = require('request-promise');

const nodeAddress = uuid().split('-').join('');

const pht = new Blockchain();


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));



app.get('/blockchain', function (req, res) {
  res.send(pht);
});



app.post('/transaction', function(req, res) {
	const newTransaction = req.body;
	const blockIndex = pht.addTransactionToPending(newTransaction);
	res.json({ note: `Transaction will be added in block ${blockIndex}.` });
});



app.post('/transaction/broadcast', function(req, res) {
	const newTransaction = pht.createNewTransaction(req.body.urlResource, req.body.amount, req.body.sender, req.body.recipient);
	pht.addTransactionToPending(newTransaction);

	const requestPromises = [];
	pht.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/transaction',
			method: 'POST',
			body: newTransaction,
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises)
	.then(data => {
		res.json({ note: 'Transaction created and broadcast successfully.' });
	});
});


app.get('/mine', function(req, res) {
	const lastBlock = pht.getLastBlock();
	const previousBlockHash = lastBlock['hash'];
	const currentBlockData = {
		transactions: pht.pendingTransactions,
		index: lastBlock['index'] + 1
	};
	const nonce = pht.proofOfWork(previousBlockHash, currentBlockData);
	const blockHash = pht.hashBlock(previousBlockHash, currentBlockData, nonce);
	const newBlock = pht.createNewBlock(nonce, previousBlockHash, blockHash);

	const requestPromises = [];
	pht.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/receive-new-block',
			method: 'POST',
			body: { newBlock: newBlock },
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises)
	.then(data => {
		const requestOptions = {
			uri: pht.currentNodeUrl + '/transaction/broadcast',
			method: 'POST',
			body: {
				urlResource: "Mining reward",
				amount: 10,
				sender: "00",
				recipient: nodeAddress
			},
			json: true
		};

		return rp(requestOptions);
	})
	.then(data => {
		res.json({
			note: "New block mined & broadcast successfully",
			block: newBlock
		});
	});
});



app.post('/receive-new-block', function(req, res) {
	const newBlock = req.body.newBlock;
	const lastBlock = pht.getLastBlock();
	const correctHash = lastBlock.hash === newBlock.previousBlockHash; 
	const correctIndex = lastBlock['index'] + 1 === newBlock['index'];

	if (correctHash && correctIndex) {
		pht.chain.push(newBlock);
		pht.pendingTransactions = [];
		res.json({
			note: 'New block received and accepted.',
			newBlock: newBlock
		});
	} else {
		res.json({
			note: 'New block rejected.',
			newBlock: newBlock
		});
	}
});



app.post('/register-and-broadcast-node', function(req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	if (pht.networkNodes.indexOf(newNodeUrl) == -1) pht.networkNodes.push(newNodeUrl);

	const regNodesPromises = [];
	pht.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/register-node',
			method: 'POST',
			body: { newNodeUrl: newNodeUrl },
			json: true
		};

		regNodesPromises.push(rp(requestOptions));
	});

	Promise.all(regNodesPromises)
	.then(data => {
		const bulkRegisterOptions = {
			uri: newNodeUrl + '/register-nodes-bulk',
			method: 'POST',
			body: { allNetworkNodes: [ ...pht.networkNodes, pht.currentNodeUrl ] },
			json: true
		};

		return rp(bulkRegisterOptions);
	})
	.then(data => {
		res.json({ note: 'New node registered with network successfully.' });
	});
});



app.post('/register-node', function(req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	const nodeNotAlreadyPresent = pht.networkNodes.indexOf(newNodeUrl) == -1;
	const notCurrentNode = pht.currentNodeUrl !== newNodeUrl;
	if (nodeNotAlreadyPresent && notCurrentNode) pht.networkNodes.push(newNodeUrl);
	res.json({ note: 'New node registered successfully.' });
});


app.post('/register-nodes-bulk', function(req, res) {
	const allNetworkNodes = req.body.allNetworkNodes;
	allNetworkNodes.forEach(networkNodeUrl => {
		const nodeNotAlreadyPresent = pht.networkNodes.indexOf(networkNodeUrl) == -1;
		const notCurrentNode = pht.currentNodeUrl !== networkNodeUrl;
		if (nodeNotAlreadyPresent && notCurrentNode) pht.networkNodes.push(networkNodeUrl);
	});

	res.json({ note: 'Bulk registration successful.' });
});



app.get('/consensus', function(req, res) {
	const requestPromises = [];
	pht.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/blockchain',
			method: 'GET',
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises)
	.then(blockchains => {
		const currentChainLength = pht.chain.length;
		let maxChainLength = currentChainLength;
		let newLongestChain = null;
		let newPendingTransactions = null;

		blockchains.forEach(blockchain => {
			if (blockchain.chain.length > maxChainLength) {
				maxChainLength = blockchain.chain.length;
				newLongestChain = blockchain.chain;
				newPendingTransactions = blockchain.pendingTransactions;
			};
		});


		if (!newLongestChain || (newLongestChain && !pht.chainIsValid(newLongestChain))) {
			res.json({
				note: 'Current chain has not been replaced.',
				chain: pht.chain
			});
		}
		else {
			pht.chain = newLongestChain;
			pht.pendingTransactions = newPendingTransactions;
			res.json({
				note: 'This chain has been replaced.',
				chain: pht.chain
			});
		}
	});
});



app.get('/block/:blockHash', function(req, res) { 
	const blockHash = req.params.blockHash;
	const correctBlock = pht.getBlock(blockHash);
	res.json({
		block: correctBlock
	});
});



app.get('/transaction/:transactionId', function(req, res) {
	const transactionId = req.params.transactionId;
	const trasactionData = pht.getTransaction(transactionId);
	res.json({
		transaction: trasactionData.transaction,
		block: trasactionData.block
	});
});



app.get('/address/:address', function(req, res) {
	const address = req.params.address;
	const addressData = pht.getAddressData(address);
	res.json({
		addressData: addressData
	});
});


app.get('/ui', function(req, res) {
	res.sendFile('./ui/index.html', { root: __dirname });
});





app.listen(port, function() {
	console.log(`Listening on port ${port}...`);
});





