"""
list_models.py
Quick diagnostic: lists every Gemini model your API key can access,
and shows which ones support embeddings vs chat.
"""
import os
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

api_key = os.getenv("GOOGLE_API_KEY")
if not api_key or api_key.startswith("AIzaSy__REPLACE"):
    print("ERROR: GOOGLE_API_KEY missing or still placeholder in .env")
    exit(1)

genai.configure(api_key=api_key)

print("\n=== Models your API key can access ===\n")
for m in genai.list_models():
    methods = ", ".join(m.supported_generation_methods)
    print(f"  {m.name}")
    print(f"     supports: {methods}\n")