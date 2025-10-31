const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const app = express();
const PORT = process.env.PORT || 3000;

// === Atlantic API Configuration ===
const ATLANTIC_API_KEY = "ag23FwT1BnrszZ5CWfYWi4WJE67EkZHdgL3WhznIsOQY1tdXi2pcDZnmDi99w1vygZGel0Jo83SXhu0wUkfwQVFJV5gVGCij7aOM"; 
const ATLANTIC_BASE_URL = "https://atlantich2h.com";

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
    maxAge: 1000 * 60 * 60 * 24, // 1 day
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
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ success: false, message: 'Unauthorized' });
}

// === Static Routes ===
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', isLoggedIn, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/products', (req, res) => res.sendFile(path.join(__dirname, 'public', 'produk.html')));
app.get('/topup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'topup.html')));
app.get('/payment', (req, res) => res.sendFile(path.join(__dirname, 'public', 'payment.html')));
app.get('/status', (req, res) => res.sendFile(path.join(__dirname, 'public', 'status.html')));

// === Login System ===
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'rerezzganteng') {
    req.session.admin = { username };
    return res.json({ success: true, message: 'Login berhasil' });
  }
  res.status(401).json({ success: false, message: 'Username/password salah' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true, message: 'Logout berhasil' }));
});

// === CRUD Produk ===
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

// === Atlantic API ===
async function atlanticRequest(endpoint, params) {
  const form = new URLSearchParams(params);
  const response = await axios.post(`${ATLANTIC_BASE_URL}${endpoint}`, form);
  return response.data;
}

// === Get Price List ===
app.get('/api/layanan', async (req, res) => {
  try {
    console.log('[LOG] Meminta daftar layanan dari Atlantic...');
    const result = await atlanticRequest('/layanan/price_list', {
      api_key: ATLANTIC_API_KEY,
      type: 'prabayar'
    });

    if (!result.status) return res.status(500).json({ success: false, message: result.message });

    const layanan = result.data.map(item => {
      const originalPrice = parseFloat(item.price);
      const markup = Math.round(originalPrice * 1.15);
      return { ...item, price: markup.toString() };
    });

    res.json({ success: true, data: layanan });
  } catch (error) {
    console.error('[ERROR] Gagal mengambil layanan Atlantic:', error.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// === Buat Transaksi ===
app.post('/api/buat-transaksi', async (req, res) => {
  const { code, tujuan, price } = req.body;
  if (!code || !tujuan || !price) return res.status(400).json({ success: false, message: 'Parameter tidak lengkap.' });

  try {
    const reffId = crypto.randomBytes(5).toString('hex').toUpperCase();
    console.log(`[LOG] Membuat deposit Atlantic untuk transaksi: ${reffId} nominal ${price}`);

    const deposit = await atlanticRequest('/deposit/create', {
      api_key: ATLANTIC_API_KEY,
      reff_id: reffId,
      nominal: price,
      type: 'ewallet',
      metode: 'qrisfast'
    });

    if (!deposit.status) return res.status(500).json({ success: false, message: deposit.message });

    transactions[reffId] = {
      atlanticId: deposit.data.id,
      productCode: code,
      target: tujuan,
      price,
      status: 'menunggu_pembayaran'
    };

    res.json({ success: true, trxId: reffId, payment: deposit.data });
  } catch (error) {
    console.error('[ERROR] Gagal membuat transaksi Atlantic:', error.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// === Cek Status Deposit ===
app.get('/api/cek-status-deposit', async (req, res) => {
  const { trxId } = req.query;
  const trx = transactions[trxId];
  if (!trx) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan.' });

  try {
    const status = await atlanticRequest('/deposit/status', {
      api_key: ATLANTIC_API_KEY,
      id: trx.atlanticId
    });

    if (status.data.status === 'success') {
      trx.status = 'membuat_order';
      const order = await atlanticRequest('/order/create', {
        api_key: ATLANTIC_API_KEY,
        code: trx.productCode,
        tujuan: trx.target
      });

      if (!order.status) return res.json({ depositStatus: 'success', orderStatus: 'failed_creation' });
      trx.orderId = order.data.id;
      trx.status = 'menunggu_hasil_order';
      res.json({ depositStatus: 'success', orderId: trx.orderId });
    } else {
      res.json({ depositStatus: status.data.status });
    }
  } catch (error) {
    console.error('[ERROR] Cek status deposit Atlantic:', error.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// === Cek Status Order ===
app.get('/api/cek-status-order', async (req, res) => {
  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ success: false, message: 'ID Order tidak ada.' });

  try {
    const status = await atlanticRequest('/order/status', {
      api_key: ATLANTIC_API_KEY,
      id: orderId
    });

    res.json(status);
  } catch (error) {
    console.error('[ERROR] Gagal cek status order Atlantic:', error.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// === Default Route ===
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));


app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));
