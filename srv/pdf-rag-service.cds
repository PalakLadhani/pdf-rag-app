/**
 * pdf-rag-service.cds
 * -------------------
 * CAP service for the PDF RAG app.
 *
 * Structure:
 *   1. namespace pdfrag   -> no dot, avoids path-resolution quirks
 *   2. Two entities: Documents (uploaded PDFs), Chats (Q&A history)
 *   3. Two actions: uploadPdf, askQuestion -- declared now,
 *      implemented later when the UI is ready.
 */

namespace pdfrag;

// -------- Data model --------
entity Documents {
    key ID         : UUID;
        filename   : String(255);
        aiDocId    : String(100);   // id returned by the Python AI service
        uploadedAt : Timestamp;
}

entity Chats {
    key ID         : UUID;
        documentID : UUID;
        question   : String(2000);
        answer     : LargeString;
        createdAt  : Timestamp;
}

// -------- Service layer --------
service PdfRagService @(path: '/pdf-rag') {

    // Expose the entities as OData endpoints
    entity Documents as projection on pdfrag.Documents;
    entity Chats     as projection on pdfrag.Chats;

    // Custom actions (stubs for now)
    action uploadPdf(fileData: LargeBinary, filename: String) returns Documents;
    action askQuestion(documentID: String, question: String) returns Chats;
}