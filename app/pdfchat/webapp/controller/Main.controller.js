sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    /**
     * Main.controller.js
     * ==================
     * Handles all user interactions for the Main view.
     *
     * BACKEND CONNECTION:
     *   All /ai/* requests are proxied by the UI5 dev server to the
     *   Python FastAPI service at http://localhost:8000.
     *
     *   /ai/health  -> GET   -> health check
     *   /ai/upload  -> POST  -> upload a PDF, returns { document_id, ... }
     *   /ai/chat    -> POST  -> { document_id, question } -> { answer }
     */
    return Controller.extend("pdfchat.controller.Main", {

        // ================================================================
        // Lifecycle
        // ================================================================
        /**
         * Runs once when the view is first created.
         * Sets up a JSONModel that holds all view state.
         */
        onInit: function () {
            const oModel = new JSONModel({
                fileSelected: false,                         // user picked a file?
                statusText: "No PDF uploaded yet.",          // label under uploader
                documentId: null,                            // id returned by Python
                filename: null,                              // PDF filename
                chats: [],                                   // chat message list
                thinking: false,                             // true while awaiting AI
                currentQuestion: ""                          // bound to input field
            });
            this.getView().setModel(oModel);

            // We store the File object here (not in the model) because
            // JSONModel serializes everything and File can't be serialized.
            this._selectedFile = null;
        },

        // ================================================================
        // FILE SELECTION
        // ================================================================
        onFileSelected: function (oEvent) {
            const aFiles = oEvent.getParameter("files");
            const oFile = aFiles && aFiles[0];
            const oModel = this.getView().getModel();

            if (!oFile) {
                this._selectedFile = null;
                oModel.setProperty("/fileSelected", false);
                oModel.setProperty("/statusText", "No PDF uploaded yet.");
                return;
            }

            this._selectedFile = oFile;
            oModel.setProperty("/fileSelected", true);
            oModel.setProperty("/statusText", "Selected: " + oFile.name);
        },

        // ================================================================
        // UPLOAD  (REAL backend call)
        // ================================================================
        /**
         * Sends the picked PDF to the Python service at POST /ai/upload.
         * We use FormData because it's a multipart file upload.
         */
        onUploadPress: async function () {
            if (!this._selectedFile) {
                MessageToast.show("Please choose a PDF first.");
                return;
            }

            const oModel = this.getView().getModel();
            const sFilename = this._selectedFile.name;

            oModel.setProperty("/statusText", "⏳ Processing your PDF, please wait...");

            try {
                // Build multipart form data. The field name "file" must
                // match the parameter name in FastAPI's @app.post("/upload").
                const formData = new FormData();
                formData.append("file", this._selectedFile);

                const response = await fetch("/ai/upload", {
                    method: "POST",
                    body: formData
                });

                if (!response.ok) {
                    // Try to read server's error detail, fall back to status
                    let errMsg = `HTTP ${response.status}`;
                    try {
                        const errJson = await response.json();
                        if (errJson.detail) { errMsg = errJson.detail; }
                    } catch (_) { /* ignore parse error */ }
                    throw new Error(errMsg);
                }

                const data = await response.json();
                // data = { document_id, filename, chunks, message }

                oModel.setProperty("/documentId", data.document_id);
                oModel.setProperty("/filename",   data.filename);
                oModel.setProperty(
                    "/statusText",
                    `✓ Ready: ${data.filename}  (${data.chunks} chunks indexed)`
                );
                oModel.setProperty("/chats", []);
                MessageToast.show("PDF processed. Ask a question!");
            } catch (err) {
                console.error("Upload failed:", err);
                oModel.setProperty("/statusText", "❌ Upload failed: " + err.message);
                MessageBox.error("Could not upload the PDF.\n\n" + err.message, {
                    title: "Upload Error"
                });
            }
        },

        // ================================================================
        // ASK QUESTION  (REAL backend call)
        // ================================================================
        /**
         * Sends the question + document_id to POST /ai/chat.
         * Adds the user's message to the chat immediately, shows a
         * "thinking" spinner, then appends the assistant's reply
         * when it arrives.
         */
        onAskPress: async function () {
            const oModel = this.getView().getModel();
            const sQuestion = (oModel.getProperty("/currentQuestion") || "").trim();

            if (!sQuestion) { return; }
            if (!oModel.getProperty("/documentId")) {
                MessageToast.show("Please upload a PDF first.");
                return;
            }

            // 1. Immediately add the user's bubble
            const aChats = oModel.getProperty("/chats").slice();
            aChats.push({
                sender: "You",
                text: sQuestion,
                timestamp: new Date().toLocaleTimeString()
            });
            oModel.setProperty("/chats", aChats);

            // 2. Clear input and show the thinking indicator
            oModel.setProperty("/currentQuestion", "");
            oModel.setProperty("/thinking", true);

            // 3. Call the backend
            try {
                const response = await fetch("/ai/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        document_id: oModel.getProperty("/documentId"),
                        question:    sQuestion
                    })
                });

                if (!response.ok) {
                    let errMsg = `HTTP ${response.status}`;
                    try {
                        const errJson = await response.json();
                        if (errJson.detail) { errMsg = errJson.detail; }
                    } catch (_) { /* ignore */ }
                    throw new Error(errMsg);
                }

                const data = await response.json();   // { answer: "..." }

                // 4. Append the assistant's reply
                const aChats2 = oModel.getProperty("/chats").slice();
                aChats2.push({
                    sender: "Assistant",
                    text: data.answer,
                    timestamp: new Date().toLocaleTimeString()
                });
                oModel.setProperty("/chats", aChats2);
            } catch (err) {
                console.error("Chat failed:", err);
                const aChats2 = oModel.getProperty("/chats").slice();
                aChats2.push({
                    sender: "Assistant",
                    text: "⚠️ Error: " + err.message,
                    timestamp: new Date().toLocaleTimeString()
                });
                oModel.setProperty("/chats", aChats2);
            } finally {
                oModel.setProperty("/thinking", false);
            }
        },

        // ================================================================
        // RESET
        // ================================================================
        /**
         * Clears the uploaded document and chat history (client-side only).
         * The RAGAgent in the Python server stays loaded — that's fine
         * because we just ignore it on the UI side.
         */
        onResetPress: function () {
            MessageBox.confirm(
                "Clear the current PDF and all messages?",
                {
                    onClose: (sAction) => {
                        if (sAction !== MessageBox.Action.OK) { return; }
                        const oModel = this.getView().getModel();
                        oModel.setData({
                            fileSelected: false,
                            statusText: "No PDF uploaded yet.",
                            documentId: null,
                            filename: null,
                            chats: [],
                            thinking: false,
                            currentQuestion: ""
                        });
                        this._selectedFile = null;
                        this.byId("fileUploader").clear();
                        MessageToast.show("Reset complete.");
                    }
                }
            );
        }
    });
});