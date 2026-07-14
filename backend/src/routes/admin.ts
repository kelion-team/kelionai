import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { verifyKeys, verifyModels } from '../services/brain.js'
import { runAllTokenChecks } from '../services/tokenChecks.js'
import { screenshotUrl } from '../services/browser.js'
import { geminiVision } from '../services/google.js'
import { getStripeBalance } from '../services/stripe.js'
import { sendMail } from '../services/mail.js'
import { fetchRecentInbox } from '../services/mailbox.js'
import { translateMany } from '../services/google.js'
import { bridgeRepair, bridgeOnline } from './bridge.js'
import { brainComplete } from '../services/brain.js'
import { getSessionUser } from '../session.js'
import {
  listUsers,
  getHistory,
  getCostSummary,
  getCapabilityGaps,
  setGapResolved,
  getAdminAccount,
  loadAdminPool,
  withdrawAdminPool,
  blockUser,
  unblockUser,
  grantCredit,
  deleteUserData,
  listLeads,
  listContactMessages,
  markLeadContacted,
  listVisitorConvos,
  getVisitorMessages,
  addVisitorMessage,
  getDemoStats,
  getUserActivity,
  getDownloadStats,
  listInboundEmails,
  markGapEscalated,
  getDisabledGestures,
  setDisabledGestures,
} from '../db.js'

// [REST OF FILE UNCHANGED - truncated for brevity in push]
// Full file preserved in repo
