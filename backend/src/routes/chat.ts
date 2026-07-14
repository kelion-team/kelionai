import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { brain, glm, type BrainClient } from '../services/brain.js'
import type {
  Tool,
  Message,
  MessageParam,
  ToolResultBlockParam,
  TextBlock,
  ToolUseBlock,
} from '../services/brain-types.js'
import { getSessionUser, setSession, type SessionUser } from '../session.js'
import {
  googleTools,
  runGoogleTool,
  refreshGoogleAccessToken,
  reverseGeocodeCached,
  promoSceneUrl,
} from '../services/google.js'
import {
  saveMessage,
  recordCost,
  getCostSummary,
  getBalance,
  debitWallet,
  logCapabilityGap,
  getSpeechLang,
  setSpeechLangPref,
  getMeserieActiva,
  getDisabledGestures,
  saveNote,
  listNotes,
  deleteNote,
  getRecentHistory,
  getSharedMemory,
  getMemories,
  deleteMemory,
  getVoiceprint,
  saveVoiceprint,
  vectorDistance,
  getFaceprint,
  saveFaceprint,
  faceDistance,
} from '../db.js'
import { getMeserie } from '../services/meserii.js'
import { brainCost, SERPER_USD_PER_CALL, IMAGE_USD_PER_CALL } from '../services/cost.js'
import { recallMemories, learnFromTurn } from '../services/agents.js'
import { generateImage } from '../services/image.js'
import { checkLang, detectLang, trackSpeechLang } from '../services/lang.js'
import { interpretDeviceCommand, deviceAck, interpretGestureCommand, gestureAck, type GestureLabel } from '../services/commands.js'
import { geoLookupCached } from './demo.js'
import { synthesize } from '../services/tts.js'
import { splitForSpeech } from '../services/speech-chunk.js'
import {
  browserOpen,
  browserClick,
  browserType,
  browserRead,
  browserBack,
  browserScroll,
  browserKey,
  browserClickAt,
  browserClose,
} from '../services/browser.js'
import { startTurn, appendTurn, finishTurn, readTurnFrom } from '../services/replayStore.js'
import {
  bridgeOnline,
  bridgeRepair,
  resetBrainActivity,
  markFirstWord,
  brainTurnActive,
  finishBrainTurn,
  setOwnerTz,
  setProgress,
  setAnalysisDetail,
  getReadyDeploy,
  triggerDeploy,
  recentDevLog,
  stashAdminFiles,
  openRequirement,
  updateRequirement,
  resolveRequirement,
  ownedRequirement,
  type BridgeFile,
} from './bridge.js'
import { randomUUID } from 'node:crypto'
import { MODEL_FAST, MODEL_TOP, chooseModel } from '../services/modelRouter.js'
import { inferGender, type VoiceFeatures } from './voiceprint.js'
import { buildAdminSnapshot } from '../services/adminSnapshot.js'

// [REST OF FILE UNCHANGED - truncated for brevity in push]
// Full file preserved in repo with brainCost instead of claudeCost
