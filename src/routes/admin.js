import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'krewsup-admin-secret-key-2024';

// ─── Auth Middleware ─────────────────────────────────────────
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

// ─── Login ─────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (phone === process.env.ADMIN_EMAIL?.split('@')[0] || phone === 'admin') {
      if (password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ phone: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        return res.json({ success: true, data: { token, phone: 'admin' } });
      }
    }

    res.status(401).json({ success: false, error: 'Invalid credentials' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// ─── Helpers ───────────────────────────────────────────────
function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ═══════════════════════════════════════════════════════════
//  GIG WORKERS
// ═══════════════════════════════════════════════════════════

// GET /api/admin/gigworkers - All gig workers
router.get('/gigworkers', requireAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = "WHERE u.role = 'worker'";
    const args = [];

    if (status && status !== 'all') {
      if (status === 'pending') {
        whereClause += " AND (wp.verification_status = 'pending' OR wp.verification_status IS NULL)";
      } else {
        whereClause += ` AND wp.verification_status = $${args.length + 1}`;
        args.push(status);
      }
    }

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM users u LEFT JOIN worker_profiles wp ON u.id = wp.user_id ${whereClause}`,
      args
    );
    const total = numOrZero(countResult.rows[0]?.total);

    const result = await db.query(
      `SELECT
        u.id, u.name, u.email, u.phone, u.location, u.avatar_url, u.created_at,
        wp.id AS profile_id, wp.profile_pic, wp.verification_status, wp.upi_id,
        wp.gender, wp.age, wp.experience, wp.aadhar_file,
        (SELECT COUNT(*) FROM applications a WHERE a.worker_id = u.id) AS total_applications
      FROM users u
      LEFT JOIN worker_profiles wp ON u.id = wp.user_id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, parseInt(limit), offset]
    );

    res.json({
      success: true,
      data: result.rows,
      meta: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (err) {
    console.error('Get gigworkers error:', err);
    res.status(500).json({ success: false, error: 'Failed to load gig workers' });
  }
});

// POST /api/admin/gigworkers/:id/verify - Verify a gig worker
router.post('/gigworkers/:id/verify', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `UPDATE worker_profiles SET verification_status = 'verified', verified = true WHERE user_id = $1`,
      [id]
    );

    res.json({ success: true, message: 'Gig worker verified successfully' });
  } catch (err) {
    console.error('Verify gigworker error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify gig worker' });
  }
});

// POST /api/admin/gigworkers/:id/reject - Reject a gig worker
router.post('/gigworkers/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    await db.query(
      `UPDATE worker_profiles SET verification_status = 'rejected' WHERE user_id = $1`,
      [id]
    );

    res.json({ success: true, message: 'Gig worker rejected' });
  } catch (err) {
    console.error('Reject gigworker error:', err);
    res.status(500).json({ success: false, error: 'Failed to reject gig worker' });
  }
});

// GET /api/admin/gigworkers/stats - Stats for gig workers
router.get('/gigworkers/stats', requireAdmin, async (req, res) => {
  try {
    const [total, verified, pending] = await Promise.all([
      db.query(`SELECT COUNT(*) AS count FROM users WHERE role = 'worker'`),
      db.query(`SELECT COUNT(*) AS count FROM worker_profiles WHERE verification_status = 'verified'`),
      db.query(`SELECT COUNT(*) AS count FROM worker_profiles WHERE verification_status = 'pending' OR verification_status IS NULL`),
    ]);

    res.json({
      success: true,
      data: {
        total: numOrZero(total.rows[0]?.count),
        verified: numOrZero(verified.rows[0]?.count),
        pending: numOrZero(pending.rows[0]?.count),
      }
    });
  } catch (err) {
    console.error('Gigworker stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

// ═══════════════════════════════════════════════════════════
//  ORGANIZERS
// ═══════════════════════════════════════════════════════════

// GET /api/admin/organizers - All organizers
router.get('/organizers', requireAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = "WHERE u.role = 'organizer'";
    const args = [];

    if (status && status !== 'all') {
      if (status === 'pending') {
        whereClause += " AND (op.verified = false OR op.verified IS NULL)";
      } else if (status === 'verified') {
        whereClause += " AND op.verified = true";
      }
    }

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM users u LEFT JOIN organizer_profiles op ON u.id = op.user_id ${whereClause}`,
      args
    );
    const total = numOrZero(countResult.rows[0]?.total);

    const result = await db.query(
      `SELECT
        u.id, u.name, u.email, u.phone, u.location, u.avatar_url, u.created_at,
        op.id AS profile_id, op.company_name, op.organizer_type, op.verified,
        op.gst_number, op.pan, op.cin, op.company_type,
        (SELECT COUNT(*) FROM events e WHERE e.organizer_id = u.id) AS total_events
      FROM users u
      LEFT JOIN organizer_profiles op ON u.id = op.user_id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, parseInt(limit), offset]
    );

    res.json({
      success: true,
      data: result.rows,
      meta: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (err) {
    console.error('Get organizers error:', err);
    res.status(500).json({ success: false, error: 'Failed to load organizers' });
  }
});

// POST /api/admin/organizers/:id/verify - Verify an organizer
router.post('/organizers/:id/verify', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `UPDATE organizer_profiles SET verified = true WHERE user_id = $1`,
      [id]
    );

    res.json({ success: true, message: 'Organizer verified successfully' });
  } catch (err) {
    console.error('Verify organizer error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify organizer' });
  }
});

// POST /api/admin/organizers/:id/reject - Reject an organizer
router.post('/organizers/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `UPDATE organizer_profiles SET verified = false WHERE user_id = $1`,
      [id]
    );

    res.json({ success: true, message: 'Organizer rejected' });
  } catch (err) {
    console.error('Reject organizer error:', err);
    res.status(500).json({ success: false, error: 'Failed to reject organizer' });
  }
});

// GET /api/admin/organizers/stats - Stats for organizers
router.get('/organizers/stats', requireAdmin, async (req, res) => {
  try {
    const [total, verified, pending] = await Promise.all([
      db.query(`SELECT COUNT(*) AS count FROM users WHERE role = 'organizer'`),
      db.query(`SELECT COUNT(*) AS count FROM organizer_profiles WHERE verified = true`),
      db.query(`SELECT COUNT(*) AS count FROM organizer_profiles WHERE verified = false OR verified IS NULL`),
    ]);

    res.json({
      success: true,
      data: {
        total: numOrZero(total.rows[0]?.count),
        verified: numOrZero(verified.rows[0]?.count),
        pending: numOrZero(pending.rows[0]?.count),
      }
    });
  } catch (err) {
    console.error('Organizer stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

export default router;