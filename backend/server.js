const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== CLOUDINARY CONFIG =====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ===== CLOUDINARY STORAGE =====
const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'FamilyFashionHub', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'] },
});
const upload = multer({ storage });

// ===== MONGODB CONNECTION =====
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ===== SCHEMAS =====

// Product Schema
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true },
  oldPrice: { type: Number, default: 0 },
  saving: { type: Number, default: 0 },
  img: { type: String, default: '' },
  images: [{ url: String, public_id: String }],
  category: { type: String, required: true },
  onSale: { type: Boolean, default: false },
  soldOut: { type: Boolean, default: false },
  featured: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Review Schema
const reviewSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, default: '' },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  productId: { type: String, default: '' },
  productName: { type: String, default: '' },
  featured: { type: Boolean, default: false },
  approved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now },
});

// Settings Schema
const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
});

// Order Schema
const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  items: [{ productId: String, name: String, price: Number, quantity: Number, img: String }],
  total: { type: Number, required: true },
  status: { type: String, default: 'pending', enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] },
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const Product = mongoose.model('Product', productSchema);
const Review = mongoose.model('Review', reviewSchema);
const User = mongoose.model('User', userSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Order = mongoose.model('Order', orderSchema);

// ===== HELPERS =====
const JWT_SECRET = process.env.JWT_SECRET || 'ffh_secret_2024';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.json({ success: false, message: 'Token নেই' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.json({ success: false, message: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.json({ success: false, message: 'Token নেই' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.json({ success: false, message: 'Admin access প্রয়োজন' });
    req.user = decoded;
    next();
  } catch {
    res.json({ success: false, message: 'Invalid token' });
  }
}

// ===== PRODUCT ROUTES =====

// Get all products (public)
app.get('/api/products', async (req, res) => {
  try {
    const { category, onSale, featured, limit = 100, page = 1, search } = req.query;
    const filter = {};
    if (category && category !== 'all') filter.category = category;
    if (onSale === 'true') filter.onSale = true;
    if (featured === 'true') filter.featured = true;
    if (search) filter.name = { $regex: search, $options: 'i' };

    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    const total = await Product.countDocuments(filter);

    res.json({ success: true, data: products, total, page: parseInt(page) });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Get single product (public)
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.json({ success: false, message: 'পণ্য পাওয়া যায়নি' });
    res.json({ success: true, data: product });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Create product (admin)
app.post('/api/products', adminMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    const { name, description, price, oldPrice, saving, category, onSale, soldOut, featured } = req.body;
    const images = (req.files || []).map(f => ({ url: f.path, public_id: f.filename }));
    const img = images.length > 0 ? images[0].url : '';

    const product = await Product.create({
      name, description, price: +price, oldPrice: +(oldPrice || 0),
      saving: +(saving || 0), category, img, images,
      onSale: onSale === 'true', soldOut: soldOut === 'true', featured: featured === 'true',
    });
    res.json({ success: true, data: product });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Update product (admin)
app.put('/api/products/:id', adminMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    const { name, description, price, oldPrice, saving, category, onSale, soldOut, featured } = req.body;
    const update = {
      name, description, price: +price, oldPrice: +(oldPrice || 0),
      saving: +(saving || 0), category,
      onSale: onSale === 'true', soldOut: soldOut === 'true', featured: featured === 'true',
    };

    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(f => ({ url: f.path, public_id: f.filename }));
      // Delete old images from cloudinary
      const old = await Product.findById(req.params.id);
      if (old?.images?.length) {
        for (const img of old.images) {
          if (img.public_id) await cloudinary.uploader.destroy(img.public_id).catch(() => {});
        }
      }
      update.images = newImages;
      update.img = newImages[0].url;
    }

    const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ success: true, data: product });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Delete product (admin)
app.delete('/api/products/:id', adminMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.json({ success: false, message: 'পণ্য পাওয়া যায়নি' });

    // Delete images from cloudinary
    for (const img of product.images || []) {
      if (img.public_id) await cloudinary.uploader.destroy(img.public_id).catch(() => {});
    }
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'পণ্য মুছে ফেলা হয়েছে' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ===== REVIEW ROUTES =====

// Get reviews (public - approved only)
app.get('/api/reviews', async (req, res) => {
  try {
    const { featured, productId } = req.query;
    const filter = { approved: true };
    if (featured === 'true') filter.featured = true;
    if (productId) filter.productId = productId;
    const reviews = await Review.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: reviews });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Get ALL reviews (admin)
app.get('/api/admin/reviews', adminMiddleware, async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 });
    res.json({ success: true, data: reviews });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Submit review (public)
app.post('/api/reviews', async (req, res) => {
  try {
    const { name, phone, rating, comment, productId, productName } = req.body;
    const review = await Review.create({ name, phone, rating: +rating, comment, productId, productName });
    res.json({ success: true, data: review, message: 'রিভিউ সফলভাবে জমা হয়েছে' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Update review (admin)
app.put('/api/reviews/:id', adminMiddleware, async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: review });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Delete review (admin)
app.delete('/api/reviews/:id', adminMiddleware, async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'রিভিউ মুছে ফেলা হয়েছে' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ===== USER ROUTES =====

// Register
app.post('/api/users/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    const exists = await User.findOne({ phone });
    if (exists) return res.json({ success: false, message: 'এই ফোন নম্বর ইতিমধ্যে নিবন্ধিত' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, phone, password: hashed });
    const token = jwt.sign({ id: user._id, phone: user.phone, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, user: { id: user._id, name: user.name, phone: user.phone, role: user.role }, token });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Login
app.post('/api/users/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.json({ success: false, message: 'ফোন নম্বর বা পাসওয়ার্ড ভুল' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'ফোন নম্বর বা পাসওয়ার্ড ভুল' });
    const token = jwt.sign({ id: user._id, phone: user.phone, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, user: { id: user._id, name: user.name, phone: user.phone, role: user.role }, token });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone, role: 'admin' });
    if (!user) return res.json({ success: false, message: 'Admin খুঁজে পাওয়া যায়নি' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'পাসওয়ার্ড ভুল' });
    const token = jwt.sign({ id: user._id, phone: user.phone, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: { id: user._id, name: user.name, phone: user.phone, role: 'admin' }, token });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Get all users (admin)
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Create admin user (admin)
app.post('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const { name, phone, password, role } = req.body;
    const exists = await User.findOne({ phone });
    if (exists) return res.json({ success: false, message: 'এই ফোন নম্বর ইতিমধ্যে আছে' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, phone, password: hashed, role: role || 'user' });
    res.json({ success: true, data: { id: user._id, name: user.name, phone: user.phone, role: user.role } });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Delete user (admin)
app.delete('/api/admin/users/:id', adminMiddleware, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'ব্যবহারকারী মুছে ফেলা হয়েছে' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ===== ORDER ROUTES =====

// Place order (public)
app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, phone, address, items, total, note } = req.body;
    const order = await Order.create({ customerName, phone, address, items, total, note });
    res.json({ success: true, data: order, message: 'অর্ডার সফলভাবে দেওয়া হয়েছে' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Get all orders (admin)
app.get('/api/admin/orders', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status && status !== 'all' ? { status } : {};
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Update order status (admin)
app.put('/api/admin/orders/:id', adminMiddleware, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: order });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Delete order (admin)
app.delete('/api/admin/orders/:id', adminMiddleware, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'অর্ডার মুছে ফেলা হয়েছে' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ===== SETTINGS ROUTES =====

// Get settings (public)
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await Settings.find();
    const data = {};
    settings.forEach(s => { data[s.key] = s.value; });
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Update settings (admin)
app.post('/api/settings', adminMiddleware, async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      await Settings.findOneAndUpdate({ key }, { key, value }, { upsert: true });
    }
    res.json({ success: true, message: 'সেটিংস আপডেট হয়েছে' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ===== STATS ROUTE =====
app.get('/api/admin/stats', adminMiddleware, async (req, res) => {
  try {
    const [products, orders, users, reviews] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments({ role: 'user' }),
      Review.countDocuments(),
    ]);
    const revenue = await Order.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);
    const pendingOrders = await Order.countDocuments({ status: 'pending' });
    res.json({
      success: true,
      data: {
        products, orders, users, reviews,
        revenue: revenue[0]?.total || 0,
        pendingOrders,
      }
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ===== IMAGE UPLOAD (standalone) =====
app.post('/api/upload', adminMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: 'কোনো ছবি নেই' });
    res.json({ success: true, url: req.file.path, public_id: req.file.filename });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ===== SETUP ADMIN (one-time) =====
app.post('/api/setup-admin', async (req, res) => {
  try {
    const count = await User.countDocuments({ role: 'admin' });
    if (count > 0) return res.json({ success: false, message: 'Admin ইতিমধ্যে আছে' });
    const { name, phone, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, phone, password: hashed, role: 'admin' });
    res.json({ success: true, message: 'Admin তৈরি হয়েছে', user: { name: user.name, phone: user.phone } });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ===== ROOT =====
app.get('/', (req, res) => res.json({ success: true, message: 'Family Fashion Hub API চলছে ✅' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));