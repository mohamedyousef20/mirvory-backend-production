import AuditLog from '../models/auditLog.model.js';
import {
  buildPaginationMeta,
  parsePageParams,
  withStableTiebreaker,
} from '../utils/pagination.js';

class AuditLogService {
  // Log admin action
  static async logAction({
    adminId,
    targetUserId,
    actionType,
    entityType,
    entityId,
    oldValue,
    newValue,
    reason,
    ipAddress,
    userAgent,
    metadata = {}
  }) {
    try {
      const auditLog = new AuditLog({
        adminId,
        targetUserId,
        actionType,
        entityType,
        entityId,
        oldValue,
        newValue,
        reason,
        ipAddress,
        userAgent,
        metadata
      });

      await auditLog.save();
      return auditLog;
    } catch (error) {
      console.error('Failed to log audit action:', error);
      // Don't throw error to avoid breaking main functionality
    }
  }

  // Get audit logs with filtering and pagination
  static async getAuditLogs(filters = {}, page = 1, limit = 50) {
    const {
      adminId,
      targetUserId,
      actionType,
      entityType,
      startDate,
      endDate
    } = filters;

    const query = {};

    // Build query filters
    if (adminId) query.adminId = adminId;
    if (targetUserId) query.targetUserId = targetUserId;
    if (actionType) query.actionType = actionType;
    if (entityType) query.entityType = entityType;

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const { page: safePage, limit: safeLimit, skip } = parsePageParams({ page, limit }, 50);

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate('adminId', 'firstName lastName email role')
        .populate('targetUserId', 'firstName lastName email role')
        .sort(withStableTiebreaker({ createdAt: -1 }))
        .skip(skip)
        .limit(safeLimit),
      AuditLog.countDocuments(query)
    ]);

    const pagination = buildPaginationMeta({ page: safePage, limit: safeLimit }, total);

    return {
      logs,
      pagination: { ...pagination, pages: pagination.totalPages }
    };
  }

  // Get audit logs for specific user
  static async getUserAuditLogs(userId, page = 1, limit = 20) {
    return this.getAuditLogs({ targetUserId: userId }, page, limit);
  }

  // Get audit logs by admin
  static async getAdminAuditLogs(adminId, page = 1, limit = 20) {
    return this.getAuditLogs({ adminId }, page, limit);
  }

  // Get audit statistics
  static async getAuditStats(adminId, startDate, endDate) {
    const matchStage = {};
    
    if (adminId) matchStage.adminId = adminId;
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    const stats = await AuditLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$actionType',
          count: { $sum: 1 },
          lastOccurrence: { $max: '$createdAt' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    return stats;
  }

  // Helper method to extract client IP
  static getClientIP(req) {
    return req.ip || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           'unknown';
  }

  // Helper method to extract user agent
  static getUserAgent(req) {
    return req.headers['user-agent'] || 'unknown';
  }
}

export default AuditLogService;
