export type ConstructionTradeCategory =
  | "NEW_CONSTRUCTION_GROUND_UP"
  | "RENOVATION_REMODEL"
  | "ROOFING_SIDING_GUTTERS"
  | "FOUNDATION_WATERPROOFING"
  | "CONCRETE_ASPHALT_PAVING"
  | "FENCE_PERIMETER_SECURITY"
  | "DEMOLITION_SITE_PREP"
  | "FIRE_WATER_REBUILD"
  | "CIVIL_INFRASTRUCTURE_PUBLIC";

export type ConstructionJurisdiction =
  | "Louisville_Metro_KY"
  | "State_Of_Kentucky"
  | "State_Of_Indiana"
  | "Clark_Floyd_IN"
  | "Federal_KY_IN";

export type ConstructionUrgency = "NORMAL" | "HIGH" | "CRITICAL";

export interface ConstructionBid {
  bidId: string;
  title: string;
  agency: string;
  jurisdiction: ConstructionJurisdiction;
  category: ConstructionTradeCategory;
  estimatedBudget?: number;
  bidDeadline?: string;
  preBidMeetingDate?: string;
  isMandatoryPreBid?: boolean;
  bondingRequired?: boolean;
  solicitationUrl: string;
  documentsUrl?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  description: string;
  naicsCode?: string;
  telegramSent?: boolean;
  createdAt?: string;
}

export type ConstructionLeadTrigger =
  | "ZONING_VARIANCE_BOZA"
  | "DEMOLITION_PRE_BUILD"
  | "STORM_HAIL_DAMAGE"
  | "MSD_BASEMENT_FLOOD"
  | "HISTORIC_LANDMARK_APPROVAL"
  | "CURB_CUT_PAVING_PERMIT"
  | "POOL_FENCE_MANDATE"
  | "FIRE_WATER_RESTORATION"
  | "CODE_VIOLATION_REPAIR_ORDER"
  | "SOCIAL_INTENT_POST"
  | "COMMERCIAL_SUB_REQUEST";

export interface ConstructionLead {
  leadId: string;
  category: ConstructionTradeCategory;
  triggerEvent: ConstructionLeadTrigger;
  address: string;
  county: string;
  state: string;
  zipCode?: string;
  ownerName?: string;
  ownerPhones: string[];
  ownerEmails: string[];
  propertyType?: string; // Residential, Commercial, Industrial, Historic
  estimatedProjectValue?: number;
  triggerDate?: string;
  urgencyLevel: ConstructionUrgency;
  sourcePortal: string;
  rawDetails: string;
  permitNumber?: string;
  insurancePayerLikely?: boolean;
  telegramSent?: boolean;
  createdAt?: string;
}

export interface ClassifierResult {
  isValidConstruction: boolean;
  rejectedReason?: string;
  category?: ConstructionTradeCategory;
  estimatedValue?: number;
  urgency?: ConstructionUrgency;
  summarySpanish?: string;
  bondingRequired?: boolean;
  deadline?: string;
}
