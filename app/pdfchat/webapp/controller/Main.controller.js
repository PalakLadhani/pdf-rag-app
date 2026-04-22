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
     * Handles all user interactions for the Main view:
     *   - file selected         -> enable the Upload button
     *   - Upload pressed        -> send PDF to backend (MOCKED for now)
     *   - Ask pressed / Enter   -> send question to backend (MOCKED for now)
     *   - Reset pressed         -> clear everything
     *
     * "MOCKED for now" = we don't have the backend yet, so we fake the
     * responses with setTimeout. Once the CAP + Python backend is ready
     * we'll replace those mock blocks with real fetch() calls.
     */
    return Controller.extend("pdfchat.controller.Main", {

        /**
         * onInit runs once when the view is first created.
         * We set up a JSONModel that holds all the view state:
         *   - fileSelected: has the user picked a file yet?
         *   - statusText:   text under the uploader
         *   - documentId:   id of the uploaded PDF (null = nothing uploaded)
         *   - chats:        array of message bubbles
         *   - thinking:     true while waiting for an AI reply
         *   - currentQuestion: two-way bound to the Input field
         */
        onInit: function () {
            const oModel = new JSONModel({
                fileSelected: false,
                statusText: "No PDF uploaded yet.",
                documentId: null,
                filename: null,
                chats: [],
                thinking: false,
                currentQuestion: ""
            });
            // setModel with no name = the "default" model, referenced as {/...}
            this.getView().setModel(oModel);

            // We hold the actual File object in a normal JS property, not
            // in the model, because JSONModel serializes everything to JSON
            // and a File can't be serialized.
            this._selectedFile = null;
        },

        // ================================================================
        // FILE SELECTION
        // ================================================================
        /**
         * Called when the user picks a file in the FileUploader.
         * We remember the File object and update the status text.
         */
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
        // UPLOAD (mocked)
        // ================================================================
        /**
         * Fake upload: pretends to send the PDF to a backend, waits 1.5 sec,
         * then sets documentId so the chat panel unhides.
         * Replace the setTimeout block with a real fetch() later.
         */
        onUploadPress: function () {
            if (!this._selectedFile) {
                MessageToast.show("Please choose a PDF first.");
                return;
            }

            const oModel = this.getView().getModel();
            const sFilename = this._selectedFile.name;

            oModel.setProperty("/statusText", "Processing your PDF, please wait...");

            // ---- MOCK BACKEND CALL --------------------------------------
            // Replace this block with:
            //   const response = await fetch("/pdf-rag/uploadPdf", {...});
            // when the backend is ready.
            setTimeout(() => {
                // Fake successful response
                const sFakeDocId = "mock-" + Date.now();
                oModel.setProperty("/documentId", sFakeDocId);
                oModel.setProperty("/filename", sFilename);
                oModel.setProperty(
                    "/statusText",
                    "✓ Ready: " + sFilename + " (mock mode)"
                );
                oModel.setProperty("/chats", []);
                MessageToast.show("PDF processed (mock). Ask a question!");
            }, 1500);
            // --------------------------------------------------------------
        },

        // ================================================================
        // ASK QUESTION (mocked)
        // ================================================================
        /**
         * Send the typed question. Immediately adds the user's bubble,
         * shows a "thinking" spinner, fakes a 1.2-sec delay, then adds
         * an assistant bubble with a canned reply.
         */
        onAskPress: function () {
            const oModel = this.getView().getModel();
            const sQuestion = (oModel.getProperty("/currentQuestion") || "").trim();

            if (!sQuestion) {
                return;  // ignore empty
            }
            if (!oModel.getProperty("/documentId")) {
                MessageToast.show("Please upload a PDF first.");
                return;
            }

            // Append user bubble
            const aChats = oModel.getProperty("/chats").slice(); // clone
            aChats.push({
                sender: "You",
                text: sQuestion,
                timestamp: new Date().toLocaleTimeString()
            });
            oModel.setProperty("/chats", aChats);

            // Clear the input and show thinking
            oModel.setProperty("/currentQuestion", "");
            oModel.setProperty("/thinking", true);

            // ---- MOCK AI CALL -------------------------------------------
            setTimeout(() => {
                const aChats2 = oModel.getProperty("/chats").slice();
                aChats2.push({
                    sender: "Assistant",
                    text:
                        "(Mock reply) I received your question: \"" +
                        sQuestion +
                        "\". Once the backend is connected, I'll answer " +
                        "using the content of your PDF.",
                    timestamp: new Date().toLocaleTimeString()
                });
                oModel.setProperty("/chats", aChats2);
                oModel.setProperty("/thinking", false);
            }, 1200);
            // --------------------------------------------------------------
        },

        // ================================================================
        // RESET
        // ================================================================
        /**
         * Clear the uploaded document and chat history.
         */
        onResetPress: function () {
            MessageBox.confirm(
                "Clear the current PDF and all messages?",
                {
                    onClose: (sAction) => {
                        if (sAction !== MessageBox.Action.OK) {
                            return;
                        }
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