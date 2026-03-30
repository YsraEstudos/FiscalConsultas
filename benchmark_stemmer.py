import time
from backend.utils.text_processor import NeshTextProcessor

processor = NeshTextProcessor()
text = "Os gatos e os cachorros são animais muito bonitos. " * 1000

start = time.time()
for _ in range(10):
    processor.process(text)
print(f"Original: {time.time() - start:.4f}s")
