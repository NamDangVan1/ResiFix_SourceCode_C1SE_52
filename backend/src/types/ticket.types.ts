import { IncidentCategory, PriorityLevel, TicketStatus, MediaType } from '@prisma/client';

export { IncidentCategory, PriorityLevel, TicketStatus, MediaType };

export interface TicketMediaItem {
  id: string;
  ticketId: string;
  mediaUrl: string;
  mediaType: MediaType;
  caption?: string | null;
  uploadedAt: Date;
}

export interface TicketStatusLogItem {
  id: string;
  ticketId: string;
  previousStatus: TicketStatus;
  newStatus: TicketStatus;
  changedById: string;
  changedAt: Date;
  note?: string | null;
}
