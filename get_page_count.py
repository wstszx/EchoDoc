import win32com.client
import os
import sys

def get_word_page_count(file_path):
    """
    使用 COM 接口来获取 Word 文档的页数。
    """
    word = None
    doc = None
    try:
        # 获取绝对路径以确保安全
        abs_path = os.path.abspath(file_path)
        if not os.path.exists(abs_path):
            print(f"错误：文件未找到于 {abs_path}", file=sys.stderr)
            sys.exit(1)

        # 启动 Word 应用
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False

        # 打开文档
        doc = word.Documents.Open(abs_path, ReadOnly=True)

        # 使用 ComputeStatistics 获取页数。
        # 2 是 wdStatisticPages 常量的值。
        page_count = doc.ComputeStatistics(2)
        print(page_count)

    except Exception as e:
        print(f"发生错误: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        # 确保所有内容都已关闭
        if doc:
            doc.Close(False)  # False = 不保存更改
        if word:
            word.Quit()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python get_page_count.py \"<word_file_path>\"", file=sys.stderr)
        sys.exit(1)
    
    file_name = sys.argv[1]
    get_word_page_count(file_name)