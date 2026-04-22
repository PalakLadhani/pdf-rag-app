/**
 * pdf-rag-service.cds
 * -------------------
 * CAP service definition for the PDF RAG application.
 *
 * For now this only declares a simple ping function so that
 * cds watch has something to serve and the HTTP server starts.
 * Later we will add real actions here:
 *   - uploadPdf(...)   -> forwards a PDF to the Python AI service
 *   - askQuestion(...) -> forwards a question to the Python AI service
 */
service PdfRagService {

    // Trivial health-check endpoint.
    function ping() returns String;
}