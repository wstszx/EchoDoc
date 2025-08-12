import docx
import os
import time
import random
import string
from tqdm import tqdm

def generate_random_paragraph(num_words=20):
    """生成一个由随机字母组成的、指定词数的段落。"""
    words = []
    for _ in range(num_words):
        word_len = random.randint(3, 10)
        word = ''.join(random.choices(string.ascii_lowercase, k=word_len))
        words.append(word)
    return ' '.join(words).capitalize() + '.'

def create_random_content_doc(output_path, target_pages):
    """
    通过生成随机文本内容来创建一个巨大的Word文档，并提供实时进度条。
    """
    # --- 步骤 1: 初始化 ---
    print("初始化新的Word文档...")
    new_doc = docx.Document()

    # --- 步骤 2: 计算所需内容总量 ---
    # 假设：每页约50个段落
    paragraphs_per_page = 50
    total_paragraphs_to_generate = target_pages * paragraphs_per_page

    print(f"目标页数: {target_pages}")
    print(f"预计每页段落数: {paragraphs_per_page}")
    print(f"需要生成的总段落数: {total_paragraphs_to_generate}")
    print("-" * 30)

    # --- 步骤 3: 带进度条的核心生成循环 ---
    start_time = time.time()
    
    # 使用tqdm提供实时进度反馈
    for _ in tqdm(range(total_paragraphs_to_generate), desc="随机内容生成中", unit="段"):
        # 实时生成随机段落并添加到文档中
        paragraph_text = generate_random_paragraph()
        new_doc.add_paragraph(paragraph_text)

    end_time = time.time()
    print("-" * 30)
    print(f"核心内容生成完成，耗时: {end_time - start_time:.2f} 秒。")

    # --- 步骤 4: 最终保存 ---
    print(f"正在保存最终文档到 {output_path}...")
    print("【请注意】此过程可能需要数分钟且不会有进度更新，请耐心等待。")
    try:
        new_doc.save(output_path)
        print("🎉 全部完成！")
    except Exception as e:
        print(f"保存文件时出错: {e}")


if __name__ == '__main__':
    # 在运行前，请确保已执行: pip install tqdm
    # 新的输出文件名，以反映其内容是随机生成的
    output_file = 'output_random_content.docx'
    target_page_count = 40000
    
    create_random_content_doc(output_file, target_page_count)