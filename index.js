process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { threadId } = require('worker_threads');
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const generatePhone = () => "0888" + Array.from({length: 8}, () => Math.floor(Math.random() * 10)).join('');

const Headers = (json) => ({
    'Accept-Encoding': 'gzip',
    'Connection': 'Keep-Alive',
    'user-agent': 'app/14.0.14 Mozilla/5.0 (Linux; Android 14; 23021RAA2Y Build/UKQ1.230917.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.54 Mobile Safari/537.36',
    ...(json && {'Content-Type': 'application/json'})
});

class XCashShop {
    constructor() {
        this.qrisChannelId = null;
        this.start();
		this.db = JSON.parse(fs.readFileSync("./db.json"));
    }

    saveDatabase() {
        fs.writeFileSync("./db.json", JSON.stringify(this.db));
    }

    async start() {
        console.log('Starting auto flash sale checker...');
        setInterval(async () => {
            try {
                await this.getQrisChannelId();
                for (const gameName of Object.keys(this.db)) {
                    const orderNotBuyed = Object.values(this.db[gameName].order).filter(x => !x.buyed);
                    if (orderNotBuyed.length > 0) {
                        const product = await this.getProduct(gameName);
                        if (!product) continue;
                        for (const order of orderNotBuyed) {
                            const eligibleItems = this.filterEligibleItems(product.items, order.itemName);
                            if (eligibleItems.length === 0) continue;
                            for (const item of eligibleItems) {
                                if (item.price <= order.minimalPrice) {
                                    for (let buy = 0; buy < order.buyCount; buy++) {
                                        this.db[gameName].order[order.uuid].buyed = true;
                                        const url = 'https://xc-api.xcashshop.com/order';
                                        const payload = {
                                            productId: item.productId,
                                            productItemId: item.productItemId,
                                            paymentChannelId: this.qrisChannelId,
                                            voucher: '',
                                            ...order.account
                                        };
                                        const options = {
                                            method: 'POST',
                                            headers: Headers(true),
                                            body: JSON.stringify(payload)
                                        };
                                        const mengOrder = (retries = 5) => {
                                            fetch(url, options).then(res => res.json()).then(res => {
                                                if (res.data) {
                                                    this.db[gameName].order[order.uuid].link.push(`https://xcashshop.com/history/${order.account.phoneNumber}/${res.data}`);
                                                }
                                            }).catch(e => {
						console.log(e);
					        if (retries > 0) {
						    console.log(`Retrying... (${retries - 1} attempts left)`);
						    mengOrder(retries - 1);
						}
					    });
					}
					mengOrder();
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to start auto flash sale checker:', error.message);
            }
			this.saveDatabase();
        }, 5000);
    }

    async getQrisChannelId() {
        const url = 'https://xc-api.xcashshop.com/payment?except=wallet';
        const data = await fetch(url, { headers: Headers() }).then(res => res.json());
        const qrisGroup = data.find(group => group.group === 'QRIS');
        if (qrisGroup && qrisGroup.datas.length > 0) {
            this.qrisChannelId = qrisGroup.datas[0].id;
            console.log('QRIS channel ID set:', this.qrisChannelId);
        } else {
            throw new Error('QRIS payment channel not found');
        }
    }

    async getProduct(gameName) {
        const url = `https://xc-api.xcashshop.com/product/${gameName === "mobile-legends" ? "weekly-diamond-pass" : gameName}`;
        const data = await fetch(url, { headers: Headers() }).then(res => res.json());
        if (!data.data) return null;
        data.data.items = data.data.items.map(x => ({...x, productId: data.data.id, productItemId: x.id}));
        if (gameName === "mobile-legends") {
            const mlData = await fetch('https://xc-api.xcashshop.com/product/mobile-legends', { headers: Headers() }).then(res => res.json());
            data.data.items = [...data.data.items, ...mlData.data.items.map(x => ({...x, productId: mlData.data.id, productItemId: x.id}))];
        }
        return data.data;
    }

    filterEligibleItems(items, name) {
        return items.filter(item => item.name.toLowerCase().includes(name.toLowerCase()));
    }

    async placeOrder(item, account) {
        const url = 'https://xc-api.xcashshop.com/order';
        const payload = {
            productId: item.productId,
            productItemId: item.productItemId,
            paymentChannelId: this.qrisChannelId,
            voucher: '',
            ...account
        };
        const options = {
            method: 'POST',
            headers: Headers(true),
            body: JSON.stringify(payload)
        };
        const data = await fetch(url, options).then(res => res.json());
        console.log('Order placed successfully:', data);
    }
}

const xcashshop = new XCashShop();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/game/:gameName', async (req, res) => {
    const { gameName } = req.params;
    const product = await xcashshop.getProduct(gameName);
    if (product) {
        res.sendFile(path.join(__dirname, 'game.html'));
    } else {
        res.status(404).send('Game not found');
    }
});

app.get('/game/:gameName/info', async (req, res) => {
    const { gameName } = req.params;
    const product = await xcashshop.getProduct(gameName);
    if (product) {
        res.json({
            title: product.title,
            userInput: product.userInput
        });
    } else {
        res.status(404).json({ error: 'Game not found' });
    }
});

app.get('/game/:gameName/account', async (req, res) => {
    const { gameName } = req.params;
    res.json(xcashshop.db[gameName]?.account || {});
});

app.post('/game/:gameName/account', async (req, res) => {
    const { gameName } = req.params;
    const { username, phoneNumber, ...data } = req.body;
    
    if (!xcashshop.db[gameName]) {
        xcashshop.db[gameName] = { account: {}, order: {}, credentials: [] };
    }
    
    xcashshop.db[gameName].account[username] = { username, data, phoneNumber: phoneNumber || generatePhone() };
    res.json({ success: true });
});

app.delete('/game/:gameName/account/:username', async (req, res) => {
    const { gameName, username } = req.params;
    
    if (xcashshop.db[gameName]?.account[username]) {
        delete xcashshop.db[gameName].account[username];
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'Account not found' });
    }
});

app.get('/game/:gameName/order', async (req, res) => {
    const { gameName } = req.params;
    res.json(xcashshop.db[gameName]?.order || {});
});

app.post('/game/:gameName/order', async (req, res) => {
    const { gameName } = req.params;
    const { itemName, minimalPrice, buyCount, accountUsernameList } = req.body;
    
    if (!xcashshop.db[gameName]) {
        xcashshop.db[gameName] = { account: {}, order: {}, credentials: [] };
    }
    
    for (let accountUsername of accountUsernameList) {
        const uuid = crypto.randomUUID();
        xcashshop.db[gameName].order[uuid] = { 
            itemName, 
            minimalPrice, 
            buyCount, 
            account: xcashshop.db[gameName].account[accountUsername],
            uuid,
			link: [],
			buyed: false
        };
    }
    
    res.json({ success: true });
});

app.delete('/game/:gameName/order/:uuid', async (req, res) => {
    const { gameName, uuid } = req.params;
    
    if (xcashshop.db[gameName]?.order[uuid]) {
        delete xcashshop.db[gameName].order[uuid];
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'Order not found' });
    }
});

app.listen(8080, () => console.log('Server running on port 8080'));
