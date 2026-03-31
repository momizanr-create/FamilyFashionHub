const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// ===== CORS CONFIG =====
// Frontend ও Admin উভয় URL থেকে request গ্রহণ করবে
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
];

app.use(cors({
  origin: function (origin, callback) {
    // Postman বা server-to-server এর জন্য origin নাও থাকতে পারে
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS policy: এই origin অনুমোদিত নয়: ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== CLOUDINARY CONFIG =====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ===== MULTER — memory storage =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // max 10MB
});

// ===== CLOUDINARY UPLOAD HELPER =====
function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: folder || 'FamilyFashionHub', resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

async function uploadMultiple(files, folder) {
  return Promise.all(files.map(f => uploadToCloudinary(f.buffer, folder)));
}

// ===== MONGODB CONNECTION =====
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected');
    // Bad unique index on orderId drop করো (যদি থাকে)
    try {
      await mongoose.connection.collection('orders').dropIndex('orderId_1');
      console.log('🔧 Bad orderId index dropped');
    } catch(e) {
      // index নেই — no problem
    }
    
    // Drop the problematic phone index on users collection
    try {
      await mongoose.connection.collection('users').dropIndex('phone_1');
      console.log('🔧 Dropped phone_1 index from users collection');
    } catch(e) {
      // index না থাকলে কিছু করার নেই
      if (e.code !== 27) console.log('ℹ️ phone_1 index not found, skipping');
    }
    
    autoSetupAdmin();
  })
  .catch(err => console.error('❌ MongoDB Error:', err));
// ===== SCHEMAS =====

const productSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  description: { type: String, default: '' },
  price:       { type: Number, required: true },
  oldPrice:    { type: Number, default: 0 },
  saving:      { type: Number, default: 0 },
  img:         { type: String, default: '' },
  images:      [{ url: String, public_id: String }],
  category:    { type: String, required: true },
  subcategory: { type: String, default: '' },
  onSale:      { type: Boolean, default: false },
  soldOut:     { type: Boolean, default: false },
  featured:    { type: Boolean, default: false },

  // ===== বিস্তারিত পণ্য তথ্য =====
  sizes:          [{ type: String }],                  // সাইজ যেমন: S, M, L, XL, 0-6M
  colors:         [{ type: String }],                  // রঙ যেমন: লাল, নীল, সাদা
  ageGroup:       { type: String, default: '' },        // বয়স: 0-6 মাস, 6-12 মাস ইত্যাদি
  material:       { type: String, default: '' },        // কাপড়: Cotton, Fleece ইত্যাদি
  stock:          { type: Number, default: 0 },         // স্টক সংখ্যা
  sku:            { type: String, default: '' },         // স্টক কোড
  weight:         { type: String, default: '' },         // ওজন/মাপ
  deliveryInfo:   { type: String, default: '' },         // ডেলিভারি তথ্য
  returnPolicy:   { type: String, default: '' },         // রিটার্ন নীতি
  highlights:     [{ type: String }],                   // মূল বৈশিষ্ট্য তালিকা
  careInstructions: { type: String, default: '' },      // পরিচর্যা নির্দেশনা
  tags:           [{ type: String }],                   // সার্চ ট্যাগ

  createdAt:   { type: Date, default: Date.now },
});

const reviewSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  phone:       { type: String, default: '' },
  rating:      { type: Number, required: true, min: 1, max: 5 },
  comment:     { type: String, required: true },
  productId:   { type: String, default: '' },
  productName: { type: String, default: '' },
  featured:    { type: Boolean, default: false },
  approved:    { type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now },
});

const userSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true },
  role:      { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now },
});

const settingsSchema = new mongoose.Schema({
  key:   { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
});

const orderSchema = new mongoose.Schema({
  customerName: { type: String, default: '' },
  phone:        { type: String, default: '' },
  address:      { type: String, default: '' },
  items: [{
    productId: String,
    name:      String,
    price:     Number,
    quantity:  Number,
    img:       String,
  }],
  total:        { type: Number, default: 0 },
  deliveryArea: { type: String, default: 'inside' },
  status:       { type: String, default: 'pending', enum: ['pending','processing','shipped','delivered','cancelled'] },
  note:         { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now },
});

const Product  = mongoose.model('Product',  productSchema);
const Review   = mongoose.model('Review',   reviewSchema);
const User     = mongoose.model('User',     userSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Order    = mongoose.model('Order',    orderSchema);

// ===== AUTO ADMIN SETUP =====
// .env-এর ADMIN_USERNAME ও ADMIN_PASSWORD দিয়ে স্বয়ংক্রিয়ভাবে admin তৈরি করবে
async function autoSetupAdmin() {
  try {
    const adminEmail = process.env.ADMIN_USERNAME; // username হিসেবে email ব্যবহার
    const adminPass  = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPass) {
      console.log('⚠️  ADMIN_USERNAME বা ADMIN_PASSWORD .env-এ নেই — auto setup স্কিপ');
      return;
    }

    const existing = await User.findOne({ email: adminEmail.toLowerCase(), role: 'admin' });
    if (existing) {
      console.log('ℹ️  Admin ইতিমধ্যে আছে:', adminEmail);
      return;
    }

    const hashed = await bcrypt.hash(adminPass, 10);
    await User.create({
      name:     'Super Admin',
      email:    adminEmail.toLowerCase(),
      password: hashed,
      role:     'admin',
    });
    console.log('✅ Auto Admin তৈরি হয়েছে — Email/Username:', adminEmail);
  } catch (err) {
    console.error('❌ Auto admin setup error:', err.message);
  }
}

// ===== AUTH HELPERS =====
const JWT_SECRET = process.env.JWT_SECRET || 'ffh_secret_2024';

function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.json({ success: false, message: 'Token নেই' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.json({ success: false, message: 'Invalid token' }); }
}

function adminMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.json({ success: false, message: 'Token নেই' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.json({ success: false, message: 'Admin access প্রয়োজন' });
    req.user = decoded;
    next();
  } catch { res.json({ success: false, message: 'Invalid token' }); }
}

// ===== PRODUCT ROUTES =====

app.get('/api/products', async (req, res) => {
  try {
    const { category, subcategory, onSale, featured, limit = 100, page = 1, search } = req.query;
    const filter = {};
    if (category && category !== 'all') filter.category = category;
    if (subcategory) filter.subcategory = subcategory;
    if (onSale   === 'true') filter.onSale   = true;
    if (featured === 'true') filter.featured = true;
    if (search) filter.name = { $regex: search, $options: 'i' };
    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    const total = await Product.countDocuments(filter);
    res.json({ success: true, data: products, total, page: parseInt(page) });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.json({ success: false, message: 'পণ্য পাওয়া যায়নি' });
    res.json({ success: true, data: product });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/products', adminMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    const {
      name, description, price, oldPrice, saving, category, subcategory, onSale, soldOut, featured,
      ageGroup, material, stock, sku, weight, deliveryInfo, returnPolicy, careInstructions,
      sizes, colors, highlights, tags,
    } = req.body;
    let images = [];
    if (req.files && req.files.length > 0) {
      const results = await uploadMultiple(req.files);
      images = results.map(r => ({ url: r.secure_url, public_id: r.public_id }));
    }
    const img = images.length > 0 ? images[0].url : '';
    // Array field parse helper (comma-separated string অথবা array হতে পারে)
    const parseArr = v => {
      if (!v) return [];
      if (Array.isArray(v)) return v.map(x => x.trim()).filter(Boolean);
      return v.split(',').map(x => x.trim()).filter(Boolean);
    };
    const product = await Product.create({
      name, description,
      price:       +price,
      oldPrice:    +(oldPrice || 0),
      saving:      +(saving   || 0),
      category,
      subcategory: subcategory || '',
      img, images,
      onSale:   onSale   === 'true',
      soldOut:  soldOut  === 'true',
      featured: featured === 'true',
      ageGroup:         ageGroup || '',
      material:         material || '',
      stock:            +(stock  || 0),
      sku:              sku || '',
      weight:           weight || '',
      deliveryInfo:     deliveryInfo || '',
      returnPolicy:     returnPolicy || '',
      careInstructions: careInstructions || '',
      sizes:      parseArr(sizes),
      colors:     parseArr(colors),
      highlights: parseArr(highlights),
      tags:       parseArr(tags),
    });
    res.json({ success: true, data: product });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/products/:id', adminMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    const {
      name, description, price, oldPrice, saving, category, subcategory, onSale, soldOut, featured,
      ageGroup, material, stock, sku, weight, deliveryInfo, returnPolicy, careInstructions,
      sizes, colors, highlights, tags,
    } = req.body;
    const parseArr = v => {
      if (!v) return [];
      if (Array.isArray(v)) return v.map(x => x.trim()).filter(Boolean);
      return v.split(',').map(x => x.trim()).filter(Boolean);
    };
    const update = {
      name, description,
      price:       +price,
      oldPrice:    +(oldPrice || 0),
      saving:      +(saving   || 0),
      category,
      subcategory: subcategory || '',
      onSale:   onSale   === 'true',
      soldOut:  soldOut  === 'true',
      featured: featured === 'true',
      ageGroup:         ageGroup || '',
      material:         material || '',
      stock:            +(stock  || 0),
      sku:              sku || '',
      weight:           weight || '',
      deliveryInfo:     deliveryInfo || '',
      returnPolicy:     returnPolicy || '',
      careInstructions: careInstructions || '',
      sizes:      parseArr(sizes),
      colors:     parseArr(colors),
      highlights: parseArr(highlights),
      tags:       parseArr(tags),
    };
    if (req.files && req.files.length > 0) {
      const old = await Product.findById(req.params.id);
      if (old && old.images && old.images.length) {
        await Promise.all(
          old.images
            .filter(img => img.public_id)
            .map(img => cloudinary.uploader.destroy(img.public_id).catch(() => {}))
        );
      }
      const results = await uploadMultiple(req.files);
      update.images = results.map(r => ({ url: r.secure_url, public_id: r.public_id }));
      update.img    = update.images[0].url;
    }
    const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ success: true, data: product });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== PRODUCT IMAGE — একটি ছবি যোগ করা =====
app.post('/api/products/:id/images', adminMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.json({ success: false, message: 'পণ্য পাওয়া যায়নি' });
    if (!req.files || req.files.length === 0) return res.json({ success: false, message: 'কোনো ছবি নেই' });
    const results = await uploadMultiple(req.files, 'FamilyFashionHub');
    const newImages = results.map(r => ({ url: r.secure_url, public_id: r.public_id }));
    product.images = [...(product.images || []), ...newImages];
    if (!product.img) product.img = product.images[0].url;
    await product.save();
    res.json({ success: true, data: product.images, message: 'ছবি যোগ হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== PRODUCT IMAGE — একটি ছবি মুছে ফেলা =====
app.delete('/api/products/:id/images/:publicId', adminMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.json({ success: false, message: 'পণ্য পাওয়া যায়নি' });
    // publicId URL-encoded হয়ে আসে, decode করো
    const publicId = decodeURIComponent(req.params.publicId);
    // Cloudinary থেকে মুছো
    await cloudinary.uploader.destroy(publicId).catch(() => {});
    // DB থেকে সরাও
    product.images = (product.images || []).filter(img => img.public_id !== publicId);
    // প্রধান img আপডেট করো
    product.img = product.images.length > 0 ? product.images[0].url : '';
    await product.save();
    res.json({ success: true, data: product.images, message: 'ছবি মুছে ফেলা হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== PRODUCT IMAGE — ক্রম পরিবর্তন =====
app.put('/api/products/:id/images/reorder', adminMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.json({ success: false, message: 'পণ্য পাওয়া যায়নি' });
    const { images } = req.body; // [{url, public_id}, ...] নতুন ক্রমে
    if (!Array.isArray(images)) return res.json({ success: false, message: 'images array প্রয়োজন' });
    product.images = images;
    product.img = images.length > 0 ? images[0].url : '';
    await product.save();
    res.json({ success: true, data: product.images, message: 'ছবির ক্রম আপডেট হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/products/:id', adminMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.json({ success: false, message: 'পণ্য পাওয়া যায়নি' });
    if (product.images && product.images.length) {
      await Promise.all(
        product.images
          .filter(img => img.public_id)
          .map(img => cloudinary.uploader.destroy(img.public_id).catch(() => {}))
      );
    }
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'পণ্য মুছে ফেলা হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== REVIEW ROUTES =====

app.get('/api/reviews', async (req, res) => {
  try {
    const { featured, productId } = req.query;
    const filter = { approved: true };
    if (featured === 'true') filter.featured = true;
    if (productId) filter.productId = productId;
    const reviews = await Review.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: reviews });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/admin/reviews', adminMiddleware, async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 });
    res.json({ success: true, data: reviews });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/reviews', async (req, res) => {
  try {
    const { name, phone, rating, comment, productId, productName } = req.body;
    const review = await Review.create({ name, phone, rating: +rating, comment, productId, productName });
    res.json({ success: true, data: review, message: 'রিভিউ সফলভাবে জমা হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/reviews/:id', adminMiddleware, async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: review });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/reviews/:id', adminMiddleware, async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'রিভিউ মুছে ফেলা হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== USER ROUTES =====

app.post('/api/users/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.json({ success: false, message: 'নাম, ইমেইল ও পাসওয়ার্ড দিন' });
    // Gmail / valid email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.json({ success: false, message: 'সঠিক ইমেইল ঠিকানা দিন' });
    const normalizedEmail = email.toLowerCase().trim();
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.json({ success: false, message: 'এই ইমেইল ইতিমধ্যে নিবন্ধিত' });
    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({ name, email: normalizedEmail, password: hashed });
    const token  = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, user: { id: user._id, name: user.name, email: user.email, role: user.role }, token });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ success: false, message: 'ইমেইল ও পাসওয়ার্ড দিন' });
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.json({ success: false, message: 'ইমেইল বা পাসওয়ার্ড ভুল' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'ইমেইল বা পাসওয়ার্ড ভুল' });
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, user: { id: user._id, name: user.name, email: user.email, role: user.role }, token });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Admin Login — email অথবা ADMIN_USERNAME দিয়ে login করা যাবে
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, phone, username, password } = req.body;
const loginId = email || phone || username; // যেকোনো একটা গ্রহণ করবে
if (!loginId || !password) return res.json({ success: false, message: 'ইউজার নেম ও পাসওয়ার্ড দিন' });
const normalizedEmail = loginId.toLowerCase().trim();

    // প্রথমে .env-এর ADMIN_USERNAME দিয়ে চেক করো
    if (
      normalizedEmail === (process.env.ADMIN_USERNAME || '').toLowerCase() &&
      password === process.env.ADMIN_PASSWORD
    ) {
      // DB-তে এই admin খোঁজো
      let user = await User.findOne({ email: normalizedEmail, role: 'admin' });
      if (!user) {
        // না থাকলে এখনই তৈরি করো
        const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        user = await User.create({
          name: 'Super Admin',
          email: normalizedEmail,
          password: hashed,
          role: 'admin',
        });
      }
      const token = jwt.sign({ id: user._id, email: user.email, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, user: { id: user._id, name: user.name, email: user.email, role: 'admin' }, token });
    }

    // সাধারণ DB-based admin login
    const user = await User.findOne({ email: normalizedEmail, role: 'admin' });
    if (!user) return res.json({ success: false, message: 'Admin খুঁজে পাওয়া যায়নি' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'পাসওয়ার্ড ভুল' });
    const token = jwt.sign({ id: user._id, email: user.email, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: { id: user._id, name: user.name, email: user.email, role: 'admin' }, token });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.json({ success: false, message: 'নাম, ইমেইল ও পাসওয়ার্ড দিন' });
    const normalizedEmail = email.toLowerCase().trim();
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.json({ success: false, message: 'এই ইমেইল ইতিমধ্যে আছে' });
    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({ name, email: normalizedEmail, password: hashed, role: role || 'user' });
    res.json({ success: true, data: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/users/:id', adminMiddleware, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'ব্যবহারকারী মুছে ফেলা হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== ORDER ROUTES =====

// ===== ORDER DEBUG (temporary — frontend কী পাঠাচ্ছে দেখার জন্য) =====
app.post('/api/orders/debug', (req, res) => {
  console.log('ORDER DEBUG body:', JSON.stringify(req.body, null, 2));
  res.json({ success: true, received: req.body });
});

app.post('/api/orders', async (req, res) => {
  try {
    const b = req.body;

    // ফ্রন্টএন্ড যেকোনো field name দিয়ে পাঠাক — সব handle করা হচ্ছে
    const customerName =
      b.customerName || b.customer_name || b.name || b.fullName ||
      b.full_name || b.userName || b.user_name || b.buyerName || '';

    const phone =
      b.phone || b.mobile || b.phoneNumber || b.phone_number ||
      b.mobileNumber || b.mobile_number || b.contact || b.number || '';

    const address =
      b.address || b.shippingAddress || b.shipping_address ||
      b.deliveryAddress || b.delivery_address || b.location || '';

    const note =
      b.note || b.notes || b.message || b.orderNote || b.order_note || '';

    // deliveryArea — 'dhaka'/'inside' = ঢাকার ভেতর, 'outside' = বাইরে
    const deliveryArea = (b.deliveryArea || b.delivery_area || b.area || 'inside') === 'outside' ? 'outside' : 'inside';

    // items — array or JSON string
    let items = b.items || b.cartItems || b.cart || b.products || [];
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch { items = []; }
    }

    // total — calculate from items if not provided
    let total = parseFloat(b.total || b.totalPrice || b.total_price ||
      b.amount || b.grandTotal || b.grand_total || 0);

    if (!total && items.length) {
      total = items.reduce((sum, item) => {
        const price = parseFloat(item.price || item.unitPrice || 0);
        const qty   = parseInt(item.quantity || item.qty || 1, 10);
        return sum + price * qty;
      }, 0);
    }

    // Validation — বাংলায় error দাও
    const errors = [];
    if (!customerName) errors.push('গ্রাহকের নাম দিন');
    if (!phone)        errors.push('ফোন নম্বর দিন');
    if (!address)      errors.push('ঠিকানা দিন');
    if (!total)        errors.push('মোট মূল্য পাওয়া যায়নি');

    if (errors.length) {
      return res.json({ success: false, message: errors.join(', ') });
    }

    // items normalize
    const normalizedItems = items.map(item => ({
      productId: item.productId || item.product_id || item._id || item.id || '',
      name:      item.name || item.productName || item.product_name || item.title || '',
      price:     parseFloat(item.price || item.unitPrice || 0),
      quantity:  parseInt(item.quantity || item.qty || 1, 10),
      img:       item.img || item.image || item.thumbnail || item.photo || '',
    }));

    const order = await Order.create({
      customerName,
      phone,
      address,
      items: normalizedItems,
      total,
      deliveryArea,
      note,
      status: 'pending',
    });

    res.json({
      success: true,
      data: order,
      message: 'অর্ডার সফলভাবে দেওয়া হয়েছে! আমরা শীঘ্রই যোগাযোগ করব।',
      orderId: order._id,
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/api/admin/orders', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = (status && status !== 'all') ? { status } : {};
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/admin/orders/:id', adminMiddleware, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: order });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/orders/:id', adminMiddleware, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'অর্ডার মুছে ফেলা হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== CATEGORIES API =====
// Frontend এই route থেকে categories ও subcategories পাবে
app.get('/api/categories', async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'categories' });
    if (setting && Array.isArray(setting.value) && setting.value.length) {
      return res.json({ success: true, data: setting.value });
    }
    // Default fallback — Baby Products full structure
    res.json({
      success: true,
      data: [
        { value: 'baby_dress', label: '🧸 Baby Dress', subcategories: [
            { value: 'newborn_set',    label: 'Newborn Set (0-6 Months)' },
            { value: 'cotton_dress',   label: 'Cotton Dress (Summer Comfort)' },
            { value: 'winter_dress',   label: 'Winter Dress' },
            { value: 'frocks_tshirts', label: 'Frocks, T-Shirts & Pants' },
        ]},
        { value: 'toys', label: '🧸 Toys', subcategories: [
            { value: 'soft_toys',        label: 'Soft Toys (Dolls)' },
            { value: 'sound_toys',       label: 'সাউন্ড টয় (Musical Toys)' },
            { value: 'educational_toys', label: 'Educational Toys (ABC/Numbers)' },
            { value: 'baby_rattle',      label: 'Baby Rattle' },
        ]},
        { value: 'feeding', label: '🍼 Feeding Items', subcategories: [
            { value: 'feeding_bottle', label: 'Feeding Bottle' },
            { value: 'feeding_bowl',   label: 'Baby Feeding Bowl + Spoon' },
            { value: 'sipper_cup',     label: 'Sipper Cup' },
            { value: 'feeding_chair',  label: 'Baby Feeding Chair' },
        ]},
        { value: 'baby_care', label: '🛁 Baby Care', subcategories: [
            { value: 'soap_shampoo', label: 'Baby Soap & Shampoo' },
            { value: 'lotion_oil',   label: 'Baby Lotion / Oil' },
            { value: 'wet_tissue',   label: 'Wet Tissue' },
            { value: 'diaper',       label: 'Diaper' },
        ]},
        { value: 'baby_bedding', label: '👶 Essentials', subcategories: [
            { value: 'mosquito_net', label: 'Baby Mosquito Net' },
            { value: 'baby_bed',     label: 'Baby Bed / Nest' },
            { value: 'blanket',      label: 'Baby Blanket' },
            { value: 'towel',        label: 'Baby Towel' },
        ]},
        { value: 'trending', label: '🔥 Trending', subcategories: [
            { value: 'baby_carrier',   label: 'Baby Carrier' },
            { value: 'baby_walker',    label: 'Baby Walker' },
            { value: 'nail_cutter',    label: 'Baby Nail Cutter Set' },
            { value: 'thermometer',    label: 'Baby Thermometer' },
        ]},
      ]
    });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== CATEGORIES CRUD (Admin) =====

// GET — সব categories
// (already handled by /api/categories above)

// POST — নতুন main category যোগ
app.post('/api/admin/categories', adminMiddleware, async (req, res) => {
  try {
    const { value, label } = req.body;
    if (!value || !label) return res.json({ success: false, message: 'value ও label আবশ্যিক' });
    const slug = value.trim().toLowerCase().replace(/\s+/g, '_');
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    if (cats.find(c => c.value === slug)) return res.json({ success: false, message: 'এই ক্যাটাগরি ইতিমধ্যে আছে' });
    cats.push({ value: slug, label: label.trim(), subcategories: [] });
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'ক্যাটাগরি যোগ হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// PUT — main category আপডেট (rename label)
app.put('/api/admin/categories/:value', adminMiddleware, async (req, res) => {
  try {
    const { label } = req.body;
    if (!label) return res.json({ success: false, message: 'label আবশ্যিক' });
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    const idx = cats.findIndex(c => c.value === req.params.value);
    if (idx === -1) return res.json({ success: false, message: 'ক্যাটাগরি পাওয়া যায়নি' });
    cats[idx].label = label.trim();
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'ক্যাটাগরি আপডেট হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// DELETE — main category মুছো
app.delete('/api/admin/categories/:value', adminMiddleware, async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    cats = cats.filter(c => c.value !== req.params.value);
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'ক্যাটাগরি মুছে ফেলা হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// POST — subcategory যোগ
app.post('/api/admin/categories/:catValue/subcategories', adminMiddleware, async (req, res) => {
  try {
    const { value, label } = req.body;
    if (!value || !label) return res.json({ success: false, message: 'value ও label আবশ্যিক' });
    const slug = value.trim().toLowerCase().replace(/\s+/g, '_');
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    const cat = cats.find(c => c.value === req.params.catValue);
    if (!cat) return res.json({ success: false, message: 'ক্যাটাগরি পাওয়া যায়নি' });
    if (!cat.subcategories) cat.subcategories = [];
    if (cat.subcategories.find(s => s.value === slug)) return res.json({ success: false, message: 'এই সাব-ক্যাটাগরি ইতিমধ্যে আছে' });
    cat.subcategories.push({ value: slug, label: label.trim() });
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'সাব-ক্যাটাগরি যোগ হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// PUT — subcategory আপডেট
app.put('/api/admin/categories/:catValue/subcategories/:subValue', adminMiddleware, async (req, res) => {
  try {
    const { label } = req.body;
    if (!label) return res.json({ success: false, message: 'label আবশ্যিক' });
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    const cat = cats.find(c => c.value === req.params.catValue);
    if (!cat) return res.json({ success: false, message: 'ক্যাটাগরি পাওয়া যায়নি' });
    const sub = (cat.subcategories || []).find(s => s.value === req.params.subValue);
    if (!sub) return res.json({ success: false, message: 'সাব-ক্যাটাগরি পাওয়া যায়নি' });
    sub.label = label.trim();
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'সাব-ক্যাটাগরি আপডেট হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// DELETE — subcategory মুছো
app.delete('/api/admin/categories/:catValue/subcategories/:subValue', adminMiddleware, async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    const cat = cats.find(c => c.value === req.params.catValue);
    if (!cat) return res.json({ success: false, message: 'ক্যাটাগরি পাওয়া যায়নি' });
    cat.subcategories = (cat.subcategories || []).filter(s => s.value !== req.params.subValue);
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'সাব-ক্যাটাগরি মুছে ফেলা হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// POST — সম্পূর্ণ categories replace (bulk save)
app.post('/api/admin/categories/bulk', adminMiddleware, async (req, res) => {
  try {
    const { categories } = req.body;
    if (!Array.isArray(categories)) return res.json({ success: false, message: 'categories array আবশ্যিক' });
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: categories }, { upsert: true });
    res.json({ success: true, data: categories, message: 'Categories সেভ হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== PUBLIC CATEGORIES API (উপরে /api/categories route-এ already handled) =====

// ===== SETTINGS ROUTES =====

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await Settings.find();
    const data = {};
    settings.forEach(s => { data[s.key] = s.value; });
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/settings', adminMiddleware, async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      await Settings.findOneAndUpdate({ key }, { key, value }, { upsert: true });
    }
    res.json({ success: true, message: 'সেটিংস আপডেট হয়েছে' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== STATS =====
app.get('/api/admin/stats', adminMiddleware, async (req, res) => {
  try {
    const [products, orders, users, reviews] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments({ role: 'user' }),
      Review.countDocuments(),
    ]);
    const revenue = await Order.aggregate([
      { $match: { status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);
    const pendingOrders = await Order.countDocuments({ status: 'pending' });
    res.json({
      success: true,
      data: { products, orders, users, reviews, revenue: revenue[0]?.total || 0, pendingOrders },
    });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== STANDALONE UPLOAD =====
app.post('/api/upload', adminMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: 'কোনো ছবি নেই' });
    const result = await uploadToCloudinary(req.file.buffer);
    res.json({ success: true, url: result.secure_url, public_id: result.public_id });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== MANUAL SETUP ADMIN (fallback) =====
app.post('/api/setup-admin', async (req, res) => {
  try {
    const count = await User.countDocuments({ role: 'admin' });
    if (count > 0) return res.json({ success: false, message: 'Admin ইতিমধ্যে আছে' });
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.json({ success: false, message: 'সব তথ্য দিন' });
    const normalizedEmail = email.toLowerCase().trim();
    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({ name, email: normalizedEmail, password: hashed, role: 'admin' });
    res.json({ success: true, message: 'Admin তৈরি হয়েছে', user: { name: user.name, email: user.email } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== ENV HEALTH CHECK (admin only) =====
app.get('/api/admin/health', adminMiddleware, (req, res) => {
  res.json({
    success: true,
    env: {
      PORT:                 process.env.PORT,
      MONGODB_URI:          process.env.MONGODB_URI ? '✅ সেট আছে' : '❌ নেই',
      CLOUDINARY_CLOUD:     process.env.CLOUDINARY_CLOUD_NAME ? '✅ সেট আছে' : '❌ নেই',
      CLOUDINARY_API_KEY:   process.env.CLOUDINARY_API_KEY ? '✅ সেট আছে' : '❌ নেই',
      CLOUDINARY_API_SECRET:process.env.CLOUDINARY_API_SECRET ? '✅ সেট আছে' : '❌ নেই',
      JWT_SECRET:           process.env.JWT_SECRET ? '✅ সেট আছে' : '❌ নেই',
      ADMIN_USERNAME:       process.env.ADMIN_USERNAME ? '✅ সেট আছে (Email)' : '❌ নেই',
      FRONTEND_URL:         process.env.FRONTEND_URL || '❌ নেই',
      ADMIN_URL:            process.env.ADMIN_URL || '❌ নেই',
    }
  });
});


// ===== SEED DEFAULT CATEGORIES (admin only) =====
// প্রথমবার রান করলে MongoDB-তে default baby categories সেট হবে
app.post('/api/admin/seed-categories', adminMiddleware, async (req, res) => {
  try {
    const existing = await Settings.findOne({ key: 'categories' });
    if (existing && Array.isArray(existing.value) && existing.value.length) {
      return res.json({ success: false, message: 'Categories ইতিমধ্যে সেট আছে। Reset করতে force=true পাঠান।' });
    }
    const defaultCategories = [
      { value: 'baby_dress', label: '🧸 Baby Dress', subcategories: [
          { value: 'newborn_set',    label: 'Newborn Set (0-6 Months)' },
          { value: 'cotton_dress',   label: 'Cotton Dress (Summer Comfort)' },
          { value: 'winter_dress',   label: 'Winter Dress' },
          { value: 'frocks_tshirts', label: 'Frocks, T-Shirts & Pants' },
      ]},
      { value: 'toys', label: '🧸 Toys', subcategories: [
          { value: 'soft_toys',        label: 'Soft Toys (Dolls)' },
          { value: 'sound_toys',       label: 'সাউন্ড টয় (Musical Toys)' },
          { value: 'educational_toys', label: 'Educational Toys (ABC/Numbers)' },
          { value: 'baby_rattle',      label: 'Baby Rattle' },
      ]},
      { value: 'feeding', label: '🍼 Feeding Items', subcategories: [
          { value: 'feeding_bottle', label: 'Feeding Bottle' },
          { value: 'feeding_bowl',   label: 'Baby Feeding Bowl + Spoon' },
          { value: 'sipper_cup',     label: 'Sipper Cup' },
          { value: 'feeding_chair',  label: 'Baby Feeding Chair' },
      ]},
      { value: 'baby_care', label: '🛁 Baby Care', subcategories: [
          { value: 'soap_shampoo', label: 'Baby Soap & Shampoo' },
          { value: 'lotion_oil',   label: 'Baby Lotion / Oil' },
          { value: 'wet_tissue',   label: 'Wet Tissue' },
          { value: 'diaper',       label: 'Diaper' },
      ]},
      { value: 'baby_bedding', label: '👶 Essentials', subcategories: [
          { value: 'mosquito_net', label: 'Baby Mosquito Net' },
          { value: 'baby_bed',     label: 'Baby Bed / Nest' },
          { value: 'blanket',      label: 'Baby Blanket' },
          { value: 'towel',        label: 'Baby Towel' },
      ]},
      { value: 'trending', label: '🔥 Trending', subcategories: [
          { value: 'baby_carrier',   label: 'Baby Carrier' },
          { value: 'baby_walker',    label: 'Baby Walker' },
          { value: 'nail_cutter',    label: 'Baby Nail Cutter Set' },
          { value: 'thermometer',    label: 'Baby Thermometer' },
      ]},
    ];
    await Settings.findOneAndUpdate(
      { key: 'categories' },
      { key: 'categories', value: defaultCategories },
      { upsert: true }
    );
    res.json({ success: true, message: 'Default baby categories সেট হয়েছে!', data: defaultCategories });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== PRODUCT PAGE LAYOUT SETTINGS =====

// GET — পণ্য পেজের লেআউট সেটিংস (Public — Frontend এর জন্য)
app.get('/api/product-layout', async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'productLayout' });
    const defaultLayout = {
      // বাটন দৃশ্যমানতা
      showAddToCart:   true,
      showBuyNow:      true,
      showWhatsApp:    true,
      showCallOrder:   true,
      // বাটনের টেক্সট
      addToCartText:   'ADD TO CART',
      buyNowText:      'BUY NOW',
      whatsappText:    'Order On WhatsApp',
      callOrderText:   'Call For Order',
      // WhatsApp ও Call নম্বর
      whatsappNumber:  '',
      callNumber:      '',
      // তিন কলাম লেআউট সেকশন দৃশ্যমানতা
      showPriceSection:       true,
      showSavingBadge:        true,
      showQuantitySelector:   true,
      showSizeSelector:       true,
      showColorSelector:      true,
      showBrandLabel:         true,
      showHighlights:         true,
      showDescription:        true,
      showMaterial:           true,
      showAgeGroup:           true,
      showDeliveryInfo:       true,
      showReturnPolicy:       true,
      showCareInstructions:   true,
      showStockStatus:        true,
      showMoreProducts:       true,
      // ডান কলাম "More Products" শিরোনাম
      moreProductsTitle:      'More Products',
      // ব্র্যান্ড লেবেল টেক্সট
      brandLabel:             'Family Fashion Hub',
      // Customer Reviews ট্যাব দেখাবে কিনা
      showReviewsTab:         true,
    };
    const layout = (setting && setting.value) ? { ...defaultLayout, ...setting.value } : defaultLayout;
    res.json({ success: true, data: layout });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// POST — পণ্য পেজের লেআউট সেটিংস আপডেট (Admin only)
app.post('/api/admin/product-layout', adminMiddleware, async (req, res) => {
  try {
    const layout = req.body;
    await Settings.findOneAndUpdate(
      { key: 'productLayout' },
      { key: 'productLayout', value: layout },
      { upsert: true }
    );
    res.json({ success: true, message: 'পণ্য পেজ লেআউট সেভ হয়েছে', data: layout });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===== ROOT =====
app.get('/', (req, res) => res.json({
  success: true,
  message: '👗 Family Fashion Hub API চলছে',
  version: '2.0.0',
  frontend: process.env.FRONTEND_URL,
  admin: process.env.ADMIN_URL,
}));

// ===== START =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));