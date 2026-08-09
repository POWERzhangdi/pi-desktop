"""
RapidOCR 识别脚本(由 ocr 扩展 spawn 调用)。
接收图片路径,输出识别文字(每行一条)。
首次运行自动下载 PaddleOCR 的 ONNX 模型(det/rec/cls),缓存于用户目录。
"""
import sys
from rapidocr_onnxruntime import RapidOCR

ocr = RapidOCR()
result, _ = ocr(sys.argv[1])
texts = [item[1] for item in result] if result else []
print("\n".join(texts))
