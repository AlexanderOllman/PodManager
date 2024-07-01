FROM python:3.8

WORKDIR /workspace

ADD requirements.txt /workspace/requirements.txt
RUN pip install -r requirements.txt

# Add the necessary files including the templates folder
ADD app.py /workspace/
ADD templates /workspace/templates

ENV HOME=/workspace

EXPOSE 80

CMD [ "python3", "/workspace/app.py" ]
