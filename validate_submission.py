import ast
import os
import re

def validate():
    errors = []
    
    # 1. Check Inference file location
    if not os.path.exists("inference.py"):
        errors.append("inference.py must be in root.")
    else:
        with open("inference.py", "r") as f:
            content = f.read()
            
        # Check variables and OpenAI usage
        if 'os.getenv("API_BASE_URL"' not in content:
            errors.append("API_BASE_URL must be defined via environment in inference.py")
        if 'os.getenv("MODEL_NAME"' not in content:
            errors.append("MODEL_NAME must be defined via environment in inference.py")
        if 'os.getenv("HF_TOKEN"' not in content:
            errors.append("HF_TOKEN must be defined via environment in inference.py")
            
        if 'OpenAI(' not in content or 'base_url=API_BASE_URL' not in content:
            errors.append("OpenAI client must use API_BASE_URL for all LLM calls.")
            
        if '[START]' not in content or '[STEP]' not in content or '[END]' not in content:
            errors.append("Structured logging [START], [STEP], [END] must be present.")
            
    # 2. Check openenv.yaml
    if not os.path.exists("openenv.yaml"):
        errors.append("openenv.yaml must exist.")
        
    # 3. Check Dockerfile
    if not os.path.exists("Dockerfile"):
        errors.append("Dockerfile must exist in root.")
    else:
        with open("Dockerfile", "r") as f:
            df = f.read()
            if "EXPOSE 7860" not in df:
                errors.append("Dockerfile must EXPOSE 7860 for HF Space.")
                
    # 4. Check Models (3+ tasks, Grader)
    if os.path.exists("models.py"):
        with open("models.py", "r") as f:
            mc = f.read()
            if "deterministic_grader" not in mc:
               errors.append("A grader function must exist in models.py.")
            if "easy" not in mc or "medium" not in mc or "hard" not in mc:
               errors.append("At least 3 difficulty tasks must be defined.")
    else:
        errors.append("models.py missing.")
            
    if not errors:
        print("✅ Validation Passed! All requirements look solid.")
    else:
        print("❌ Validation Failed:")
        for e in errors:
            print("  -", e)

if __name__ == "__main__":
    validate()
