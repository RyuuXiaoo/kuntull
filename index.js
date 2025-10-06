const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const app = express();
const PORT = process.env.PORT || 3000;

const CIAA_API_KEY = "APIKEY_CIAA_TOPUP";
const CIAA_BASE_URL = "https://www.ciaatopup.my.id/h2h";

const transactions = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


const mongoURI = 'mongodb+srv://playmusic:playmusic@cluster0.a7fx9x1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

app.use(session({
  secret: 'kurumi-secret-session',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: mongoURI }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 hari
  }
}));

const productSchema = new mongoose.Schema({
  nama: { type: String, required: true },
  deks: { type: String },
  fulldesk: { type: String },
  imageurl: { type: String },
  linkorder: { type: String },
  tanggal: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);

function isLoggedIn(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  } else {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', isLoggedIn, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/products', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'produk.html'));
});

app.get('/topup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'topup.html'));
});

app.get('/payment', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

app.get('/status', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status.html'));
});


app.post('/login', (req, res) => {
  const { username, password } = req.body;

  // hardcoded login, bisa ganti ke DB
  if (username === 'admin' && password === 'rerezzganteng') {
    req.session.admin = { username };
    return res.json({ success: true, message: 'Login berhasil' });
  }

  res.status(401).json({ success: false, message: 'Username/password salah' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: 'Logout berhasil' });
  });
});

app.post('/produk', isLoggedIn, async (req, res) => {
  try {
    const produk = new Product(req.body);
    const saved = await produk.save();
    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/produk', async (req, res) => {
  try {
    const data = await Product.find().sort({ tanggal: -1 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/produk/:id', isLoggedIn, async (req, res) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });
    res.json({ success: true, message: 'Produk berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


const ciaaApi = axios.create({
    baseURL: CIAA_BASE_URL,
    headers: { 'X-APIKEY': CIAA_API_KEY }
});

app.get('/api/layanan', async (req, res) => {
    try {
        console.log('[LOG] Meminta daftar layanan dari VPedia...');
        const response = await ciaaApi.get('/layanan/price-list');

        if (response.data && response.data.success) {
            const layanan = response.data.data.map(item => {
                const originalPrice = parseFloat(item.price);
                const markup = Math.round(originalPrice * 1.15); // naik 15% dan dibulatkan
                return {
                    ...item,
                    price: markup.toString()
                };
            });

            res.json({ success: true, data: layanan });
        } else {
            res.status(500).json({ success: false, message: 'Gagal mengambil data layanan.' });
        }
    } catch (error) {
        console.error('[ERROR] Gagal saat mengambil layanan:', error.message);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
    }
});


app.post('/api/buat-transaksi', async (req, res) => {
    const { code, tujuan, price } = req.body;
    if (!code || !tujuan || !price) {
        return res.status(400).json({ success: false, message: 'Parameter tidak lengkap.' });
    }

    try {
        const internalTrxId = crypto.randomUUID();
        console.log(`[LOG] Membuat permintaan deposit untuk Transaksi Internal: ${internalTrxId} dengan nominal: ${price}`);

        const depositResponse = await ciaaApi.get(`/deposit/create?nominal=${price}`);
        console.log('[LOG] Respon dari VPedia (Buat Deposit):', JSON.stringify(depositResponse.data, null, 2));

        if (depositResponse.data && depositResponse.data.success) {
            const depositData = depositResponse.data.data;
            transactions[internalTrxId] = {
                vPediaDepositId: depositData.id,
                productCode: code,
                target: tujuan,
                price: price,
                status: 'menunggu_pembayaran',
                vPediaOrderId: null
            };

            res.json({
                success: true,
                internalTrxId: internalTrxId,
                paymentDetails: depositData
            });
        } else {
            res.status(500).json({ success: false, message: 'Gagal membuat permintaan deposit.' });
        }
    } catch (error) {
        console.error('[ERROR] Gagal saat membuat transaksi:', error.message);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
    }
});

app.get('/api/cek-status-deposit', async (req, res) => {
    const { trxId } = req.query;
    if (!trxId || !transactions[trxId]) {
        return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan.' });
    }

    const transaction = transactions[trxId];
    if (transaction.status !== 'menunggu_pembayaran') {
        return res.json({ depositStatus: 'success', orderId: transaction.vPediaOrderId });
    }
    
    try {
        console.log(`[LOG] Mengecek status deposit VPedia ID: ${transaction.vPediaDepositId}`);
        const statusResponse = await ciaaApi.get(`/deposit/status?id=${transaction.vPediaDepositId}`);
        console.log('[LOG] Respon dari VPedia (Cek Deposit):', JSON.stringify(statusResponse.data, null, 2));

        if (statusResponse.data.success && statusResponse.data.data.status === 'success') {
            console.log(`[LOG] Deposit Sukses. Membuat order untuk produk: ${transaction.productCode} ke ${transaction.target}`);
            transaction.status = 'membuat_order';

            const orderResponse = await ciaaApi.get(`/order/create?code=${transaction.productCode}&tujuan=${transaction.target}`);
            console.log('[LOG] Respon dari VPedia (Buat Order):', JSON.stringify(orderResponse.data, null, 2));

            if (orderResponse.data && orderResponse.data.success) {
                transaction.vPediaOrderId = orderResponse.data.data.id;
                transaction.status = 'menunggu_hasil_order';
                res.json({
                    depositStatus: 'success',
                    orderId: transaction.vPediaOrderId
                });
            } else {
                transaction.status = 'gagal_buat_order';
                res.json({ depositStatus: 'success', orderStatus: 'failed_creation' });
            }
        } else {
            res.json({ depositStatus: statusResponse.data.data.status || 'pending' });
        }
    } catch (error) {
        console.error('[ERROR] Gagal saat cek status deposit:', error.message);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
    }
});

app.get('/api/cek-status-order', async (req, res) => {
    const { orderId } = req.query;
    if (!orderId) {
        return res.status(400).json({ success: false, message: 'ID Order tidak ada.' });
    }
    try {
        console.log(`[LOG] Mengecek status order VPedia ID: ${orderId}`);
        const statusResponse = await ciaaApi.get(`/order/check?id=${orderId}`);
        console.log('[LOG] Respon dari VPedia (Cek Order):', JSON.stringify(statusResponse.data, null, 2));

        res.json(statusResponse.data);
    } catch (error) {
        console.error('[ERROR] Gagal saat cek status order:', error.message);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});

